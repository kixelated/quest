import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import * as store from "../src/jobs/store";
import { GRACE } from "../src/jobs/store";
import { privateKey } from "./github-key";
import { identity, oauth, origin } from "./login-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
const commit = "a".repeat(40);
const head = "d".repeat(40);
const documents = [
	{
		path: "quest/README.md",
		content: "# Project\n\n## Goal\n\nBuild it.\n\n## Required\n\n- [First](/quest/first.md)\n",
	},
	{ path: "quest/first.md", content: "# [S] First\n\n## Goal\n\nBuild first.\n" },
];

async function user(id: string) {
	await db
		.prepare("INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)")
		.bind(id, id, `${id}@example.test`)
		.run();
}
async function project(id: number, owner: string, state: "enabled" | "paused" = "enabled") {
	await db
		.prepare(
			"INSERT INTO github_projects(id,owner,name,installation,state,enrolledBy,updatedAt) VALUES(?,'upstream','project',5,?,?,0) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
		)
		.bind(id, state, owner)
		.run();
}
async function runner(owner: string, name: string, platform: store.Platform = "linux", vm = false) {
	const { id, token } = await store.createRunner(db, owner, name, platform, vm, 0);
	return { id, token, owner, name, platform, vm: vm ? 1 : 0 } as store.Runner & { token: string };
}
function account(id: string, limited = false): store.AccountReport {
	return { id, provider: "anthropic", kind: "subscription", label: id, limited };
}
async function connected(r: store.Runner, accounts: store.AccountReport[]) {
	await store.report(db, r, accounts, [], true, 0);
}
async function job(repository: number, actor: string, extra: Partial<store.NewJob> = {}, now = 0) {
	return (
		await store.createJob(
			db,
			{
				repository,
				actor,
				workflow: "start",
				target: "quest/first.md",
				revision: commit,
				branch: "quest/first",
				trusted: true,
				...extra,
			},
			now,
		)
	).id;
}
async function state(id: string) {
	return (await store.readJob(db, id))!;
}
/** One dispatch pass over connected runners and their free slots. */
function run(slots: Record<string, number>, now: number, owner = "owner") {
	return store.dispatch(db, owner, new Map(Object.entries(slots)), now);
}

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
	]);
	await user("owner");
	await user("other");
	await project(10, "owner");
});
afterEach(() => vi.restoreAllMocks());

describe("job coordination", () => {
	it("assigns a job exactly once across racing dispatch passes and records the placement", async () => {
		const runners = await Promise.all(["a", "b", "c"].map((name) => runner("owner", name)));
		for (const r of runners) await connected(r, [account(`${r.name}-account`)]);
		const id = await job(10, "owner");
		const slots = Object.fromEntries(runners.map((r) => [r.id, 1]));
		const passes = await Promise.all([run(slots, 1), run(slots, 1), run(slots, 1)]);
		const assigned = passes.flatMap((pass) => pass.assign);
		expect(assigned).toHaveLength(1);
		expect(assigned[0]!.job).toMatchObject({
			id,
			attempt: 1,
			owner: "upstream",
			name: "project",
			state: "running",
		});
		expect((await state(id)).events).toEqual([
			{
				attempt: 1,
				kind: "claimed",
				body: { runner: assigned[0]!.runner, account: assigned[0]!.job.account },
				at: 1,
			},
		]);
	});

	it("routes by the owner's account preference across connected runners with free slots", async () => {
		const first = await runner("owner", "first");
		const second = await runner("owner", "second");
		await connected(first, [account("one")]);
		await connected(second, [account("two")]);
		await db.prepare("UPDATE runner_accounts SET rank=0 WHERE id='two'").run();
		const id = await job(10, "owner");
		expect((await run({ [first.id]: 1, [second.id]: 1 }, 1)).assign).toMatchObject([
			{ runner: second.id, job: { id, account: "two" } },
		]);
		// A busy preferred runner leaves the next account to take new work.
		const other = await job(10, "owner", { workflow: "plan", target: "issues/1" }, 2);
		expect((await run({ [first.id]: 1, [second.id]: 0 }, 3)).assign).toMatchObject([
			{ runner: first.id, job: { id: other, account: "one" } },
		]);
		await job(10, "owner", { workflow: "plan", target: "issues/2" }, 4);
		expect((await run({}, 5)).assign).toEqual([]);
	});

	it("keeps untrusted heads, pins, other owners, and paused projects away from unsuitable runners", async () => {
		const mac = await runner("owner", "mac", "darwin");
		const linux = await runner("owner", "linux");
		const vm = await runner("owner", "vm", "linux", true);
		const stranger = await runner("other", "stranger");
		for (const r of [mac, linux, vm, stranger]) await connected(r, [account("main")]);
		const untrusted = await job(10, "owner", { workflow: "iterate", target: "pulls/2", trusted: false });
		expect((await run({ [stranger.id]: 1, [mac.id]: 1, [linux.id]: 1 }, 1)).assign).toEqual([]);
		expect((await run({ [stranger.id]: 1 }, 1, "other")).assign).toEqual([]);
		expect((await run({ [mac.id]: 1, [linux.id]: 1, [vm.id]: 1 }, 1)).assign).toMatchObject([
			{ runner: vm.id, job: { id: untrusted } },
		]);

		await db.prepare("UPDATE runner_accounts SET rank=99 WHERE runner=?").bind(mac.id).run();
		const pinned = await job(10, "owner", { pinRunner: mac.id, pinAccount: "main" }, 2);
		expect((await run({ [linux.id]: 1, [mac.id]: 1 }, 3)).assign).toMatchObject([
			{ runner: mac.id, job: { id: pinned } },
		]);
		await expect(job(10, "owner", { target: "x", pinRunner: stranger.id })).rejects.toThrow("Pinned runner");
		await expect(job(10, "owner", { target: "x", pinAccount: "main" })).rejects.toThrow("together");

		await project(10, "owner", "paused");
		await job(10, "owner", { target: "issues/3", workflow: "plan" }, 4);
		expect((await run({ [linux.id]: 1 }, 5)).assign).toEqual([]);
	});

	it("returns the active job for duplicate requests and allows new work after it ends", async () => {
		const id = await job(10, "owner");
		expect(
			await store.createJob(
				db,
				{
					repository: 10,
					actor: "other",
					workflow: "start",
					target: "quest/first.md",
					revision: commit,
					branch: "quest/first",
					trusted: true,
				},
				1,
			),
		).toEqual({ id, created: false });
		await store.cancel(db, id, "owner", 2);
		expect(await job(10, "owner")).not.toBe(id);
	});

	it("reassigns a disconnected runner's job after the grace period and fences it out", async () => {
		const old = await runner("owner", "old");
		const replacement = await runner("owner", "replacement");
		await connected(old, [account("old")]);
		await connected(replacement, [account("new")]);
		const id = await job(10, "owner");
		await run({ [old.id]: 1 }, 0);
		await store.checkpoint(db, old, id, 1, "Wrote the parser", "session-1", 10);
		expect((await run({ [old.id]: 0, [replacement.id]: 1 }, 20)).assign).toEqual([]);
		// Disconnecting starts the grace period instead of moving the job at once.
		expect(await run({ [replacement.id]: 1 }, 30)).toMatchObject({ assign: [], wake: 30 + GRACE });
		expect((await run({ [replacement.id]: 1 }, 30 + GRACE - 1)).assign).toEqual([]);
		expect((await run({ [replacement.id]: 1 }, 30 + GRACE)).assign).toMatchObject([
			{
				runner: replacement.id,
				job: {
					id,
					attempt: 2,
					// A different runner continues from the summaries, not the old session.
					session: null,
					events: [
						{ kind: "claimed", attempt: 1 },
						{ kind: "summary", attempt: 1, body: "Wrote the parser" },
						{ kind: "claimed", attempt: 2 },
					],
				},
			},
		]);
		const late = 31 + GRACE;
		await expect(store.checkpoint(db, old, id, 1, "Still here", null, late)).rejects.toThrow("no longer current");
		await expect(store.output(db, old, id, 1, "late output", late)).rejects.toThrow("no longer current");
		await expect(
			store.finish(db, old, id, 1, { outcome: "completed", summary: "Done", result: { pr: 1 } }, late),
		).rejects.toThrow("no longer current");
		await expect(store.ask(db, old, id, 1, { summary: "?", session: "s", prompt: {} }, late)).rejects.toThrow(
			"no longer current",
		);
		expect(await store.report(db, old, [account("old")], [{ job: id, attempt: 1 }], true, late)).toEqual([
			{ job: id, attempt: 1, action: "stop" },
		]);
		const done = { outcome: "completed", summary: "Done", result: { pr: 1 } } as const;
		await store.finish(db, replacement, id, 2, done, late + 1);
		// A retried report is accepted once; the job keeps the replacement's result.
		await store.finish(db, replacement, id, 2, done, late + 2);
		expect(await state(id)).toMatchObject({ state: "completed", summary: "Done", result: { pr: 1 }, attempt: 2 });
		expect((await state(id)).events.filter((e) => e.kind === "result")).toHaveLength(1);
	});

	it("keeps a job on a runner that reconnects in time and moves one a restarted runner lost", async () => {
		const machine = await runner("owner", "machine");
		await connected(machine, [account("main")]);
		const id = await job(10, "owner");
		await run({ [machine.id]: 1 }, 0);
		await run({}, 1);
		expect((await state(id)).lease).toBe(1 + GRACE);
		const listed = [{ job: id, attempt: 1 }];
		expect(await store.report(db, machine, [account("main")], listed, true, 2)).toEqual([
			{ job: id, attempt: 1, action: "continue" },
		]);
		await run({ [machine.id]: 0 }, 3);
		expect(await state(id)).toMatchObject({ state: "running", lease: null });
		// Later statuses on a connection may race an assignment, so they never requeue.
		await store.report(db, machine, [account("main")], [], false, 4);
		expect((await state(id)).state).toBe("running");
		// A new connection's first status is complete: a restarted runner lost it.
		await store.report(db, machine, [account("main")], [], true, 5);
		expect((await state(id)).state).toBe("queued");
	});

	it("pauses on a question, accepts one answer, and resumes the same session where it lives", async () => {
		const home = await runner("owner", "home");
		const away = await runner("owner", "away");
		await connected(home, [account("main")]);
		await connected(away, [account("spare")]);
		const id = await job(10, "owner");
		await run({ [home.id]: 1 }, 0);
		const input = { summary: "Need a decision", session: "session-1", prompt: { question: "A or B?" } };
		const question = await store.ask(db, home, id, 1, input, 1);
		expect(await store.ask(db, home, id, 1, input, 2)).toBe(question);
		expect(await state(id)).toMatchObject({ state: "waiting", lease: null, session: "session-1" });
		await expect(store.answer(db, id, "missing", "owner", "A", 3)).rejects.toThrow("no longer open");
		await Promise.allSettled([
			store.answer(db, id, question, "owner", "A", 3),
			store.answer(db, id, question, "other", "B", 3),
		]);
		const answered = await state(id);
		expect(answered.state).toBe("queued");
		expect(answered.questions).toHaveLength(1);
		expect(["A", "B"]).toContain(answered.questions[0]!.answer);
		await expect(store.answer(db, id, question, "owner", "C", 4)).rejects.toThrow("no longer open");
		// The other runner waits while the session's runner is connected but busy.
		expect((await run({ [home.id]: 0, [away.id]: 1 }, 5)).assign).toEqual([]);
		expect((await run({ [home.id]: 1, [away.id]: 1 }, 6)).assign).toMatchObject([
			{ runner: home.id, job: { id, attempt: 2, session: "session-1" } },
		]);
	});

	it("pauses an account-limited job with a decision instead of switching accounts", async () => {
		const machine = await runner("owner", "machine");
		await connected(machine, [account("first"), account("second")]);
		const id = await job(10, "owner");
		expect((await run({ [machine.id]: 2 }, 0)).assign).toMatchObject([{ job: { account: "first" } }]);
		await store.finish(db, machine, id, 1, { outcome: "limited", summary: "Hit the limit", result: undefined }, 1);
		const paused = await state(id);
		expect(paused).toMatchObject({ state: "waiting", summary: "Hit the limit" });
		expect(paused.questions).toMatchObject([{ kind: "account", prompt: { runner: machine.id, account: "first" } }]);
		expect((await run({ [machine.id]: 2 }, 2)).assign).toEqual([]);
		// Other work avoids the limited account while it is flagged.
		const other = await job(10, "owner", { workflow: "plan", target: "issues/9" }, 3);
		expect((await run({ [machine.id]: 2 }, 4)).assign).toMatchObject([{ job: { id: other, account: "second" } }]);
		const choice = paused.questions[0]!.id;
		await expect(store.answer(db, id, choice, "owner", { runner: machine.id, account: "nope" }, 5)).rejects.toThrow(
			"owner's accounts",
		);
		await store.answer(db, id, choice, "owner", { runner: machine.id, account: "first" }, 5);
		expect(await state(id)).toMatchObject({
			state: "queued",
			pinRunner: machine.id,
			pinAccount: "first",
			session: null,
		});
		expect((await run({ [machine.id]: 1 }, 6)).assign).toMatchObject([
			{ job: { id, account: "first", attempt: 2 } },
		]);
	});

	it("cancels queued work immediately and asks running work to stop with its partial result", async () => {
		const machine = await runner("owner", "machine");
		await connected(machine, [account("main")]);
		const queued = await job(10, "owner");
		await store.cancel(db, queued, "owner", 1);
		expect(await state(queued)).toMatchObject({ state: "cancelled" });
		await expect(store.cancel(db, queued, "owner", 2)).rejects.toThrow("already finished");

		const running = await job(10, "owner", {}, 3);
		await run({ [machine.id]: 1 }, 3);
		await store.cancel(db, running, "owner", 4);
		expect((await run({ [machine.id]: 0 }, 5)).cancel).toEqual([{ job: running, attempt: 1, runner: machine.id }]);
		expect(await store.report(db, machine, [account("main")], [{ job: running, attempt: 1 }], false, 5)).toEqual([
			{ job: running, attempt: 1, action: "cancel" },
		]);
		expect(await store.checkpoint(db, machine, running, 1, "Stopping", null, 6)).toEqual({ cancel: true });
		const stopped = { outcome: "cancelled", summary: "Stopped after the parser", result: undefined } as const;
		await store.finish(db, machine, running, 1, stopped, 7);
		expect(await state(running)).toMatchObject({ state: "cancelled", summary: "Stopped after the parser" });

		// A cancelled attempt whose runner vanished stops instead of moving.
		const abandoned = await job(10, "owner", {}, 8);
		await run({ [machine.id]: 1 }, 8);
		await store.cancel(db, abandoned, "owner", 9);
		await run({}, 10);
		expect((await run({}, 10 + GRACE)).assign).toEqual([]);
		expect(await state(abandoned)).toMatchObject({ state: "cancelled" });
	});

	it("keeps account preference order and removes accounts a runner stops reporting", async () => {
		const first = await runner("owner", "first");
		const second = await runner("owner", "second");
		await connected(first, [account("a"), account("b")]);
		await connected(second, [account("c")]);
		await store.report(db, first, [account("b", true)], [], false, 1);
		const listed = await store.listRunners(db, "owner", new Set([first.id]));
		const [one, two] = ["first", "second"].map((name) => listed.find((r) => r.name === name));
		expect(one).toMatchObject({ name: "first", online: true, accounts: [{ id: "b", rank: 2, limited: 1 }] });
		expect(two).toMatchObject({ name: "second", online: false, accounts: [{ id: "c", rank: 3 }] });
	});

	it("deletes jobs with their project on disconnect", async () => {
		const id = await job(10, "owner");
		await db.prepare("DELETE FROM github_projects WHERE id=10").run();
		expect(await store.readJob(db, id)).toBeNull();
	});
});

describe("runner connections", () => {
	const hub = () => env.RUNNERS.get(env.RUNNERS.idFromName("owner"));
	const sockets: WebSocket[] = [];
	afterEach(() => {
		for (const ws of sockets.splice(0)) ws.close();
	});

	function request(token: string | null, upgrade = true) {
		return app.request(
			`${origin}/api/runner/connect`,
			{
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					...(upgrade ? { Upgrade: "websocket" } : {}),
				},
			},
			testEnv,
		);
	}
	async function connect(token: string) {
		const response = await request(token);
		expect(response.status).toBe(101);
		const ws = response.webSocket!;
		ws.accept();
		sockets.push(ws);
		const inbox: unknown[] = [];
		const waiting: ((message: unknown) => void)[] = [];
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data as string);
			const next = waiting.shift();
			if (next) next(message);
			else inbox.push(message);
		});
		const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
		return {
			ws,
			closed,
			send: (message: unknown) => ws.send(JSON.stringify(message)),
			next: (): Promise<any> =>
				inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiting.push(resolve)),
		};
	}
	const status = (id: number, name: string, attempts: store.Attempt[] = [], slots = 1) => ({
		id,
		type: "status",
		accounts: [account(name)],
		attempts,
		slots,
	});

	it("requires a registered runner token and a WebSocket", async () => {
		const machine = await runner("owner", "machine");
		expect((await request(null)).status).toBe(401);
		expect((await request("x".repeat(43))).status).toBe(401);
		expect((await request(machine.token, false)).status).toBe(426);
	});

	it("pushes assignments and cancellation and fences progress over the live connection", async () => {
		const machine = await runner("owner", "machine");
		const live = await connect(machine.token);
		live.send(status(1, "main"));
		expect(await live.next()).toEqual({ type: "reply", id: 1, attempts: [] });
		expect(await hub().online()).toEqual([machine.id]);
		const id = await job(10, "owner", {}, Date.now());
		await hub().dispatch("owner");
		expect(await live.next()).toMatchObject({
			type: "assign",
			job: { id, attempt: 1, revision: commit, branch: "quest/first", owner: "upstream", account: "main" },
		});
		live.send({ id: 2, type: "checkpoint", job: id, attempt: 1, summary: "Halfway" });
		expect(await live.next()).toEqual({ type: "reply", id: 2, cancel: false });
		live.send({ id: 3, type: "output", job: id, attempt: 1, text: "raw log" });
		expect(await live.next()).toEqual({ type: "reply", id: 3 });
		live.send({ id: 4, type: "checkpoint", job: id, attempt: 2, summary: "Wrong attempt" });
		expect(await live.next()).toEqual({ type: "reply", id: 4, error: "Attempt is no longer current" });
		live.send({ id: 5, type: "result", job: id, attempt: 1, outcome: "done", summary: "x" });
		expect(await live.next()).toEqual({ type: "reply", id: 5, error: "Outcome and summary required" });
		live.send({ id: 6, type: "deploy" });
		expect(await live.next()).toEqual({ type: "reply", id: 6, error: "Unknown message type" });
		await store.cancel(db, id, "owner", Date.now());
		await hub().dispatch("owner");
		expect(await live.next()).toEqual({ type: "cancel", job: id, attempt: 1 });
		live.send({ id: 7, type: "result", job: id, attempt: 1, outcome: "cancelled", summary: "Stopped" });
		expect(await live.next()).toEqual({ type: "reply", id: 7 });
		expect(await state(id)).toMatchObject({ state: "cancelled", summary: "Stopped" });
		expect(await store.readOutput(db, id)).toMatchObject([{ attempt: 1, text: "raw log" }]);
	});

	it("keeps a job across a replaced connection and reassigns it after a disconnect", async () => {
		const first = await runner("owner", "first");
		const second = await runner("owner", "second");
		const old = await connect(first.token);
		old.send(status(1, "a"));
		await old.next();
		const id = await job(10, "owner", {}, Date.now());
		await hub().dispatch("owner");
		expect(await old.next()).toMatchObject({ type: "assign", job: { id, attempt: 1 } });

		// Reconnecting replaces the old connection; the job stays put.
		const fresh = await connect(first.token);
		expect(await old.closed).toBe(4000);
		fresh.send(status(1, "a", [{ job: id, attempt: 1 }]));
		expect(await fresh.next()).toEqual({
			type: "reply",
			id: 1,
			attempts: [{ job: id, attempt: 1, action: "continue" }],
		});
		expect(await state(id)).toMatchObject({ state: "running", runner: first.id, lease: null });

		const other = await connect(second.token);
		other.send(status(1, "b"));
		await other.next();
		fresh.ws.close(1000);
		await fresh.closed;
		await hub().dispatch("owner");
		expect((await state(id)).lease).toBeGreaterThan(Date.now());
		// The grace period ends: the hub's alarm moves the job to the connected runner.
		await db.prepare("UPDATE jobs SET lease=1 WHERE id=?").bind(id).run();
		expect(await runDurableObjectAlarm(hub())).toBe(true);
		expect(await other.next()).toMatchObject({ type: "assign", job: { id, attempt: 2, runner: second.id } });
	});
});

describe("job routes", () => {
	const base = `${origin}/projects/github/upstream/project/jobs`;
	let maintainer = "";
	let cookie = "";
	let flake = true;
	let role = "maintain";

	beforeEach(async () => {
		flake = true;
		role = "maintain";
		const who = identity("github");
		cookie = (await oauth(who)).session!;
		maintainer = (await db
			.prepare("SELECT userId FROM account WHERE providerId='github' AND accountId=?")
			.bind(who.id)
			.first<{ userId: string }>())!.userId;
		await project(10, maintainer);
		const snapshot = { commit, date: "2026-10-16", documents, completed: [] };
		const scan = { id: "scan", issues: false, pulls: false, refs: false, claims: [], complete: true };
		const pull = {
			databaseId: "21",
			number: 2,
			title: "Fix",
			state: "OPEN",
			updatedAt: "2026-10-16T00:00:00Z",
			author: null,
			comments: { totalCount: 0 },
			headRefName: "contributor/fix",
			headRefOid: head,
		};
		const issue = {
			databaseId: "11",
			number: 1,
			title: "Idea",
			state: "OPEN",
			updatedAt: "2026-10-16T00:00:00Z",
			author: null,
			comments: { totalCount: 0 },
		};
		await db.batch([
			db
				.prepare(
					"INSERT INTO github_project_state(repository,epoch,snapshot,scan,observedAt) VALUES(10,'e',?,?,0)",
				)
				.bind(JSON.stringify(snapshot), JSON.stringify(scan)),
			db
				.prepare(
					"INSERT INTO github_project_activity(repository,kind,id,number,firstSeen,changedAt,data,seenIn) VALUES(10,'pull','21',2,0,0,?,'scan'),(10,'issue','11',1,0,0,?,'scan')",
				)
				.bind(JSON.stringify(pull), JSON.stringify(issue)),
		]);
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = new URL(String(input));
			const path = url.pathname;
			if (path.endsWith("/installation"))
				return Response.json({
					id: 5,
					app_id: 123,
					suspended_at: null,
					permissions: { metadata: "read", contents: "read" },
				});
			if (path.endsWith("/access_tokens")) return Response.json({ token: "installation-token" });
			if (path === "/installation/token") return new Response(null, { status: 204 });
			if (path === "/repos/upstream/project")
				return Response.json({
					id: 10,
					name: "project",
					owner: { login: "upstream" },
					private: false,
					visibility: "public",
					default_branch: "trunk",
					archived: false,
					disabled: false,
				});
			if (path.startsWith("/user/")) return Response.json({ id: Number(who.id), login: "maintainer" });
			if (path.endsWith("/permission"))
				return Response.json({ user: { id: Number(who.id) }, permission: "write", role_name: role });
			if (path === "/repos/upstream/project/contents/flake.nix" && url.searchParams.get("ref") === commit)
				return flake ? Response.json({ type: "file" }) : new Response(null, { status: 404 });
			throw new Error(`Unexpected GitHub request ${path}`);
		});
	});

	function post(path: string, body: unknown, headers: Record<string, string> = { Cookie: cookie, Origin: origin }) {
		return app.request(
			`${base}${path}`,
			{ method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) },
			testEnv,
		);
	}

	it("authorizes each workflow against current observations and deduplicates requests", async () => {
		const started = await post("", { workflow: "start", target: "quest/first.md" });
		expect(started.status).toBe(201);
		const { id } = (await started.json()) as { id: string };
		expect(await (await post("", { workflow: "start", target: "quest/first.md" })).json()).toEqual({
			id,
			created: false,
		});
		expect((await post("", { workflow: "start", target: "quest/README.md" })).status).toBe(409);
		expect((await post("", { workflow: "plan", target: "issues/7" })).status).toBe(409);
		expect((await post("", { workflow: "plan", target: "issues/1" })).status).toBe(201);
		expect((await post("", { workflow: "plan" })).status).toBe(201);
		expect((await post("", { workflow: "iterate", target: "pulls/2" })).status).toBe(201);
		expect((await post("", { workflow: "bootstrap" })).status).toBe(409);
		expect((await post("", { workflow: "deploy" })).status).toBe(409);
		const listed = (await (await app.request(base, { headers: { Cookie: cookie } }, testEnv)).json()) as {
			jobs: store.Job[];
		};
		expect(listed.jobs.map((j) => [j.workflow, j.target, j.revision, j.branch, j.trusted, j.actor])).toEqual(
			expect.arrayContaining([
				["start", "quest/first.md", commit, "quest/first", 1, maintainer],
				["plan", "issues/1", commit, "plan/issue-1", 1, maintainer],
				["iterate", "pulls/2", head, "contributor/fix", 0, maintainer],
			]),
		);
	});

	it("offers a devShell bootstrap job instead of starting without a flake", async () => {
		flake = false;
		const refused = await post("", { workflow: "start", target: "quest/first.md" });
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({ bootstrap: true });
		expect((await post("", { workflow: "bootstrap" })).status).toBe(201);
	});

	it("refuses new work on paused projects and requests without current authority or origin", async () => {
		expect((await post("", { workflow: "plan" }, { Cookie: cookie, Origin: "https://evil.example" })).status).toBe(
			403,
		);
		expect((await post("", { workflow: "plan" }, { Origin: origin })).status).toBe(403);
		role = "write";
		expect((await post("", { workflow: "plan" })).status).toBe(403);
		role = "maintain";
		await project(10, maintainer, "paused");
		expect((await post("", { workflow: "plan" })).status).toBe(409);
	});

	it("answers, cancels, and reads raw output only for the project's current maintainers", async () => {
		const machine = await runner(maintainer, "machine");
		await connected(machine, [account("main")]);
		const { id } = (await (await post("", { workflow: "start", target: "quest/first.md" })).json()) as {
			id: string;
		};
		await store.dispatch(db, maintainer, new Map([[machine.id, 1]]), Date.now());
		await store.output(db, machine, id, 1, "secret transcript", Date.now());
		const question = await store.ask(
			db,
			machine,
			id,
			1,
			{ summary: "Which?", session: "s", prompt: { q: 1 } },
			Date.now(),
		);
		const output = () => app.request(`${base}/${id}/output`, { headers: { Cookie: cookie } }, testEnv);
		expect(await (await output()).json()).toEqual({
			output: [expect.objectContaining({ text: "secret transcript" })],
		});
		role = "write";
		expect((await output()).status).toBe(403);
		expect((await post(`/${id}/answer`, { question, answer: "A" })).status).toBe(403);
		role = "maintain";
		expect((await post(`/${id}/answer`, { question, answer: "A" })).status).toBe(204);
		expect((await post(`/${id}/answer`, { question, answer: "B" })).status).toBe(409);
		expect((await post(`/${id}/cancel`, {})).status).toBe(204);
		expect(await state(id)).toMatchObject({ state: "cancelled" });
		expect((await post(`/missing/cancel`, {})).status).toBe(409);
	});

	it("registers runners for the signed-in user only", async () => {
		const register = (headers: Record<string, string>, body: unknown = { name: "laptop", platform: "darwin" }) =>
			app.request(
				`${origin}/api/runners`,
				{
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
				testEnv,
			);
		expect((await register({ Origin: origin })).status).toBe(403);
		expect((await register({ Cookie: cookie, Origin: "https://evil.example" })).status).toBe(403);
		expect((await register({ Cookie: cookie, Origin: origin }, { name: "x", platform: "windows" })).status).toBe(
			409,
		);
		const created = await register({ Cookie: cookie, Origin: origin });
		expect(created.status).toBe(201);
		const { token } = (await created.json()) as { token: string };
		expect(await store.authenticate(db, token)).toMatchObject({
			owner: maintainer,
			name: "laptop",
			platform: "darwin",
		});
		const listed = await app.request(`${origin}/api/runners`, { headers: { Cookie: cookie } }, testEnv);
		expect(JSON.stringify(await listed.json())).not.toContain(token);
	});
});
