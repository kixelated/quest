import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createAuth } from "../auth";
import { GitHubError, GitHubService } from "../github/service";
import type { Pull } from "../github/state";
import * as store from "./store";
import { JobError } from "./store";

type Bindings = { Bindings: Env; Variables: { runner: store.Runner } };
export const jobs = new Hono<Bindings>();

function text(value: unknown, max: number): string | null {
	return typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;
}
function id(value: unknown): string | null {
	return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
}
function attempt(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new JobError("Attempt required");
	return value;
}
async function json(c: Context): Promise<Record<string, unknown>> {
	try {
		const body = await c.req.json();
		if (body && typeof body === "object" && !Array.isArray(body)) return body;
	} catch {}
	throw new JobError("JSON object required");
}
// Prompts, results, and summaries are untrusted agent data stored as given.
function data(value: unknown, max: number) {
	if (value !== undefined && JSON.stringify(value).length > max) throw new JobError("Payload too large");
	return value;
}

// Runners authenticate with the token their owner registered them with.
// Runner requests carry no cookies, so they need no origin check.
jobs.use("/api/runner/*", bodyLimit({ maxSize: 1024 * 1024 }), async (c, next) => {
	const token = c.req.header("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
	const runner = token && (await store.authenticate(c.env.DB, token));
	if (!runner) return c.json({ error: "Runner token required" }, 401);
	c.set("runner", runner);
	await next();
});

jobs.post("/api/runner/heartbeat", async (c) => {
	const body = await json(c);
	if (!Array.isArray(body.accounts) || !Array.isArray(body.attempts) || body.attempts.length > 100)
		throw new JobError("Accounts and attempts required");
	const accounts = body.accounts.map((account): store.AccountReport => {
		const kind = account?.kind;
		const report = {
			id: id(account?.id),
			provider: id(account?.provider),
			kind,
			label: text(account?.label, 100),
			limited: account?.limited,
		};
		if (
			!report.id ||
			!report.provider ||
			!report.label ||
			(kind !== "subscription" && kind !== "api-key") ||
			typeof report.limited !== "boolean"
		)
			throw new JobError("Invalid account");
		return report as store.AccountReport;
	});
	if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new JobError("Duplicate account");
	const attempts = body.attempts.map((item) => {
		const job = id(item?.job);
		if (!job) throw new JobError("Invalid attempt");
		return { job, attempt: attempt(item.attempt) };
	});
	return c.json({ attempts: await store.heartbeat(c.env.DB, c.var.runner, accounts, attempts, Date.now()) });
});

jobs.post("/api/runner/claim", async (c) => {
	const job = await store.claim(c.env.DB, c.var.runner, Date.now());
	return job ? c.json({ job }) : c.body(null, 204);
});

jobs.post("/api/runner/jobs/:job/checkpoint", async (c) => {
	const body = await json(c);
	const summary = text(body.summary, 4000);
	if (!summary) throw new JobError("Summary required");
	const session = body.session === undefined ? null : text(body.session, 200);
	if (body.session !== undefined && !session) throw new JobError("Invalid session");
	return c.json(
		await store.checkpoint(
			c.env.DB,
			c.var.runner,
			c.req.param("job"),
			attempt(body.attempt),
			summary,
			session,
			Date.now(),
		),
	);
});

jobs.post("/api/runner/jobs/:job/questions", async (c) => {
	const body = await json(c);
	const summary = text(body.summary, 4000);
	const session = text(body.session, 200);
	if (!summary || !session || body.prompt === undefined) throw new JobError("Summary, session, and prompt required");
	const question = await store.ask(
		c.env.DB,
		c.var.runner,
		c.req.param("job"),
		attempt(body.attempt),
		{ summary, session, prompt: data(body.prompt, 64 * 1024) },
		Date.now(),
	);
	return c.json({ question });
});

jobs.post("/api/runner/jobs/:job/output", async (c) => {
	const body = await json(c);
	if (typeof body.text !== "string" || !body.text) throw new JobError("Output text required");
	await store.output(c.env.DB, c.var.runner, c.req.param("job"), attempt(body.attempt), body.text, Date.now());
	return c.body(null, 204);
});

jobs.post("/api/runner/jobs/:job/result", async (c) => {
	const body = await json(c);
	const summary = text(body.summary, 4000);
	const outcome = body.outcome;
	if (
		!summary ||
		(outcome !== "completed" && outcome !== "failed" && outcome !== "cancelled" && outcome !== "limited")
	)
		throw new JobError("Outcome and summary required");
	await store.finish(
		c.env.DB,
		c.var.runner,
		c.req.param("job"),
		attempt(body.attempt),
		{ outcome, summary, result: data(body.result, 64 * 1024) },
		Date.now(),
	);
	return c.body(null, 204);
});

// A signed-in user registers their own machines and sees their presence.
async function signedIn(c: Context<Bindings>) {
	const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
	if (!session) throw new GitHubError("Sign in required");
	return session.user.id;
}
jobs.use("/api/runners", async (c, next) => {
	if (c.req.method === "POST" && c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin)
		return c.json({ error: "Invalid origin" }, 403);
	await next();
});
jobs.get("/api/runners", async (c) => {
	c.header("Cache-Control", "no-store");
	return c.json({ runners: await store.listRunners(c.env.DB, await signedIn(c), Date.now()) });
});
jobs.post("/api/runners", async (c) => {
	const owner = await signedIn(c);
	const body = await json(c);
	const name = text(body.name, 100);
	if (
		!name ||
		(body.platform !== "linux" && body.platform !== "darwin") ||
		(body.vm !== undefined && typeof body.vm !== "boolean")
	)
		throw new JobError("Name and platform required");
	c.header("Cache-Control", "no-store");
	return c.json(await store.createRunner(c.env.DB, owner, name, body.platform, body.vm === true, Date.now()), 201);
});

// Every maintainer action rechecks current GitHub authority, not just the page load.
async function maintained(c: Context<Bindings>) {
	const user = await signedIn(c);
	const github = new GitHubService(c.env);
	const repo = await github.enrolledProject(c.req.param("owner")!, c.req.param("repository")!, user);
	if (!repo) throw new GitHubError("Project is not enrolled");
	return { user, repo, github };
}
async function owned(c: Context<Bindings>) {
	const { user, repo } = await maintained(c);
	const job = await store.readJob(c.env.DB, c.req.param("job")!);
	if (!job || job.repository !== repo.id) throw new JobError("Job not found");
	return { user, job };
}

const base = "/projects/github/:owner/:repository/jobs";
jobs.get(base, async (c) => {
	const { repo } = await maintained(c);
	c.header("Cache-Control", "no-store");
	return c.json({ jobs: await store.listJobs(c.env.DB, repo.id) });
});

/**
 * Authorize one workflow on one target. Planning, implementation, and
 * iteration are separate requests; arriving issues and PRs only observe.
 */
jobs.post(base, async (c) => {
	const { user, repo, github } = await maintained(c);
	const body = await json(c);
	const workflow = body.workflow;
	const pinRunner = body.runner === undefined ? null : id(body.runner);
	const pinAccount = body.account === undefined ? null : id(body.account);
	if ((body.runner !== undefined && !pinRunner) || (body.account !== undefined && !pinAccount))
		throw new JobError("Invalid runner or account");
	const source = await github.jobSource(repo, user);
	if (!source.enabled) throw new JobError("Contributions are paused");
	if (workflow !== "bootstrap" && !source.flake)
		return c.json(
			{ error: "A flake devShell is required; start a bootstrap job to add one", bootstrap: true },
			409,
		);
	const { state } = source;
	const commit = state.project.commit;
	const target = body.target;
	let job: Omit<store.NewJob, "repository" | "actor" | "pinRunner" | "pinAccount">;
	if (workflow === "start") {
		if (typeof target !== "string" || !state.available.includes(target))
			throw new JobError("Only ready, unclaimed quests on the default branch can start");
		job = { workflow, target, revision: commit, branch: target.replace(/(\/README)?\.md$/, ""), trusted: true };
	} else if (workflow === "plan") {
		if (target === undefined) {
			const plan = crypto.randomUUID();
			job = {
				workflow,
				target: `plans/${plan}`,
				revision: commit,
				branch: `plan/${plan.slice(0, 8)}`,
				trusted: true,
			};
		} else {
			const issue = state.activity.find(
				(item) =>
					item.kind === "issue" &&
					`issues/${item.number}` === target &&
					!item.missing &&
					item.data?.state === "OPEN",
			);
			if (!issue) throw new JobError("Plan an open issue or start a new plan");
			job = {
				workflow,
				target: `issues/${issue.number}`,
				revision: commit,
				branch: `plan/issue-${issue.number}`,
				trusted: true,
			};
		}
	} else if (workflow === "iterate") {
		const pull = state.activity.find(
			(item) =>
				item.kind === "pull" &&
				`pulls/${item.number}` === target &&
				!item.missing &&
				item.data?.state === "OPEN",
		);
		if (!pull) throw new JobError("Iterate on an open pull request");
		const data = pull.data as Pull;
		// Until the sandbox classifies commit authors, every PR head is untrusted
		// and routes only to Linux runners that build its devShell in a VM.
		job = {
			workflow,
			target: `pulls/${pull.number}`,
			revision: data.headRefOid,
			branch: data.headRefName,
			trusted: false,
		};
	} else if (workflow === "bootstrap") {
		if (source.flake) throw new JobError("The default branch already has a flake");
		job = { workflow, target: "devshell", revision: commit, branch: "quest/devshell", trusted: true };
	} else throw new JobError("Unknown workflow");
	const created = await store.createJob(
		c.env.DB,
		{ ...job, repository: repo.id, actor: user, pinRunner, pinAccount },
		Date.now(),
	);
	return c.json(created, created.created ? 201 : 200);
});

jobs.post(`${base}/:job/answer`, async (c) => {
	const { user, job } = await owned(c);
	const body = await json(c);
	const question = id(body.question);
	if (!question || body.answer === undefined) throw new JobError("Question and answer required");
	await store.answer(c.env.DB, job.id, question, user, data(body.answer, 64 * 1024), Date.now());
	return c.body(null, 204);
});

jobs.post(`${base}/:job/cancel`, async (c) => {
	const { user, job } = await owned(c);
	await store.cancel(c.env.DB, job.id, user, Date.now());
	return c.body(null, 204);
});

// Raw output stays behind a per-request maintainer check; summaries are the default view.
jobs.get(`${base}/:job/output`, async (c) => {
	const { job } = await owned(c);
	c.header("Cache-Control", "no-store");
	return c.json({ output: await store.readOutput(c.env.DB, job.id) });
});
