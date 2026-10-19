import { type Context, Hono } from "hono";
import { createAuth } from "../auth";
import { GitHubError, GitHubService, refName, type Stopped } from "../github/service";
import type { ProjectState, Pull } from "../github/state";
import { RUNNER_HEADER } from "./hub";
import { data, id, text } from "./protocol";
import { LIMITS, parsePublication, publish } from "./publish";
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

/** Dispatch for everyone with queued work on a project that resumed, since no runner event may follow. */
export async function resume(env: Env, repository: number) {
	const { results } = await env.DB.prepare("SELECT DISTINCT actor FROM jobs WHERE repository=? AND state='queued'")
		.bind(repository)
		.all<{ actor: string }>();
	await Promise.all(results.map(({ actor }) => hub(env, actor).dispatch(actor)));
}

/** Stop the running attempts of a disconnected project, whose job records are already gone. */
export async function stop(env: Env, attempts: Stopped[]) {
	const actors = new Map<string, Stopped[]>();
	for (const a of attempts) actors.set(a.actor, [...(actors.get(a.actor) ?? []), a]);
	await Promise.all([...actors].map(([actor, list]) => hub(env, actor).stop(list)));
}

// A runner authenticates with the token its owner registered it with, then
// holds one live connection to its owner's hub. Runner requests carry no
// cookies, so they need no origin check.
async function machine(c: Context<Bindings>) {
	const token = c.req.header("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
	return (token && (await store.authenticate(c.env.DB, token))) || null;
}
jobs.get("/api/runner/connect", async (c) => {
	const runner = await machine(c);
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

// A running attempt publishes its work over HTTPS rather than its connection,
// so slow GitHub writes never hold up the hub's other runner messages.
jobs.post("/api/runner/publish", async (c) => {
	const runner = await machine(c);
	if (!runner) return c.json({ error: "Runner token required" }, 401);
	const length = Number(c.req.header("Content-Length"));
	if (!Number.isSafeInteger(length) || length > LIMITS.request)
		return c.json({ error: `A Content-Length of at most ${LIMITS.request} bytes is required` }, 413);
	const result = await publish(c.env, runner, parsePublication(await json(c)));
	if (!("decision" in result)) return c.json(result);
	await hub(c.env, runner.owner).dispatch(runner.owner);
	return c.json(result, 202);
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

type Plan = Omit<store.NewJob, "repository" | "actor" | "pinRunner" | "pinAccount">;

/** Resolve a requested workflow and target against current observations. */
function resolve(workflow: unknown, target: unknown, state: ProjectState): Plan {
	const commit = state.project.commit;
	const open = (kind: "issue" | "pull", prefix: string) =>
		state.activity.find(
			(item) =>
				item.kind === kind &&
				`${prefix}/${item.number}` === target &&
				!item.missing &&
				item.data?.state === "OPEN",
		);
	if (workflow === "start") {
		if (typeof target !== "string" || !state.available.includes(target))
			throw new JobError("Only ready, unclaimed quests on the default branch can start");
		const branch = target.replace(/(\/README)?\.md$/, "");
		if (!refName(branch)) throw new JobError("Rename the quest so its path can be a branch name");
		return { workflow, target, revision: commit, branch, trusted: true };
	}
	if (workflow === "plan") {
		if (target === undefined) {
			const plan = crypto.randomUUID();
			return {
				workflow,
				target: `plans/${plan}`,
				revision: commit,
				branch: `plan/${plan.slice(0, 8)}`,
				trusted: true,
			};
		}
		const issue = open("issue", "issues");
		if (!issue) throw new JobError("Plan an open issue or start a new plan");
		const n = issue.number;
		return { workflow, target: `issues/${n}`, revision: commit, branch: `plan/issue-${n}`, trusted: true };
	}
	if (workflow === "iterate") {
		const pull = open("pull", "pulls");
		if (!pull) throw new JobError("Iterate on an open pull request");
		const data = pull.data as Pull;
		// Until the sandbox classifies commit authors, every PR head is untrusted
		// and routes only to Linux runners that build its devShell in a VM.
		return {
			workflow,
			target: `pulls/${pull.number}`,
			revision: data.headRefOid,
			branch: data.headRefName,
			trusted: false,
		};
	}
	if (workflow === "bootstrap")
		return { workflow, target: "devshell", revision: commit, branch: "quest/devshell", trusted: true };
	throw new JobError("Unknown workflow");
}

/**
 * Authorize one workflow on one target. Planning, implementation, and
 * iteration are separate requests; arriving issues and PRs only observe.
 */
jobs.post(base, async (c) => {
	const { user, repo, github } = await maintained(c);
	const body = await json(c);
	const pinRunner = body.runner === undefined ? null : id(body.runner);
	const pinAccount = body.account === undefined ? null : id(body.account);
	if ((body.runner !== undefined && !pinRunner) || (body.account !== undefined && !pinAccount))
		throw new JobError("Invalid runner or account");
	const { job, enabled, flake } = await github.jobSource(repo, user, (state) =>
		resolve(body.workflow, body.target, state),
	);
	if (!enabled) throw new JobError("Contributions are paused");
	if (job.workflow === "bootstrap") {
		if (flake) throw new JobError("The default branch already has a flake");
	} else if (!flake) {
		if (job.workflow === "iterate") throw new JobError("The pull request's head has no flake devShell");
		return c.json(
			{ error: "A flake devShell is required; start a bootstrap job to add one", bootstrap: true },
			409,
		);
	}
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
	// `after=<attempt>.<seq>` continues from a previous page's `next`.
	const after = c.req.query("after");
	const cursor = after?.match(/^(\d{1,15})\.(\d{1,15})$/);
	if (after !== undefined && !cursor) throw new JobError("Invalid output cursor");
	c.header("Cache-Control", "no-store");
	return c.json(
		await store.readOutput(
			c.env.DB,
			job.id,
			cursor ? { attempt: Number(cursor[1]), seq: Number(cursor[2]) } : null,
		),
	);
});
