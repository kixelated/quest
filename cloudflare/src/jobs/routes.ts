import { type Context, Hono } from "hono";
import { createAuth } from "../auth";
import { GitHubError, GitHubService } from "../github/service";
import type { Pull } from "../github/state";
import { RUNNER_HEADER } from "./hub";
import { data, id, text } from "./protocol";
import * as store from "./store";
import { JobError } from "./store";

type Bindings = { Bindings: Env };
export const jobs = new Hono<Bindings>();

async function json(c: Context): Promise<Record<string, unknown>> {
	try {
		const body = await c.req.json();
		if (body && typeof body === "object" && !Array.isArray(body)) return body;
	} catch {}
	throw new JobError("JSON object required");
}

/** The owner's hub, which holds their runners' connections and routes their jobs. */
function hub(env: Env, owner: string) {
	return env.RUNNERS.get(env.RUNNERS.idFromName(owner));
}

// A runner authenticates with the token its owner registered it with, then
// holds one live connection to its owner's hub. Runner requests carry no
// cookies, so they need no origin check.
jobs.get("/api/runner/connect", async (c) => {
	const token = c.req.header("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
	const runner = token && (await store.authenticate(c.env.DB, token));
	if (!runner) return c.json({ error: "Runner token required" }, 401);
	if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "WebSocket required" }, 426);
	const headers = new Headers(c.req.raw.headers);
	headers.delete("Authorization");
	headers.set(RUNNER_HEADER, JSON.stringify(runner));
	const upgraded = await hub(c.env, runner.owner).fetch(new Request(c.req.raw, { headers }));
	// Rewrap so shared middleware can still set headers on the upgrade.
	return new Response(null, {
		status: upgraded.status,
		webSocket: upgraded.webSocket,
		headers: new Headers(upgraded.headers),
	});
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
	const owner = await signedIn(c);
	const online = new Set(await hub(c.env, owner).online());
	return c.json({ runners: await store.listRunners(c.env.DB, owner, online) });
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
	await hub(c.env, user).dispatch(user);
	return c.json(created, created.created ? 201 : 200);
});

jobs.post(`${base}/:job/answer`, async (c) => {
	const { user, job } = await owned(c);
	const body = await json(c);
	const question = id(body.question);
	if (!question || body.answer === undefined) throw new JobError("Question and answer required");
	await store.answer(c.env.DB, job.id, question, user, data(body.answer, 64 * 1024), Date.now());
	// Jobs run on their requester's runners, whoever answers.
	await hub(c.env, job.actor).dispatch(job.actor);
	return c.body(null, 204);
});

jobs.post(`${base}/:job/cancel`, async (c) => {
	const { user, job } = await owned(c);
	await store.cancel(c.env.DB, job.id, user, Date.now());
	await hub(c.env, job.actor).dispatch(job.actor);
	return c.body(null, 204);
});

// Raw output stays behind a per-request maintainer check; summaries are the default view.
jobs.get(`${base}/:job/output`, async (c) => {
	const { job } = await owned(c);
	c.header("Cache-Control", "no-store");
	return c.json({ output: await store.readOutput(c.env.DB, job.id) });
});
