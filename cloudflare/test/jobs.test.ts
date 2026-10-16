import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import * as store from "../src/jobs/store";
import { LEASE, ONLINE } from "../src/jobs/store";
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
	it("gives a job to exactly one of several racing runners and records the placement", async () => {
		const runners = await Promise.all(["a", "b", "c"].map((name) => runner("owner", name)));
		for (const r of runners) await store.heartbeat(db, r, [account(`${r.name}-account`)], [], 1000);
		const id = await job(10, "owner");
		// Every runner is polling, so whichever asks first may take the job.
		for (const r of runners) await db.prepare("UPDATE runners SET pollAt=1000 WHERE id=?").bind(r.id).run();
		const claims = await Promise.all(runners.map((r) => store.claim(db, r, 1001)));
		const won = claims.filter((c) => c !== null);
		expect(won).toHaveLength(1);
		expect(won[0]).toMatchObject({ id, attempt: 1, owner: "upstream", name: "project", state: "running" });
		expect((await state(id)).events).toEqual([
			{ attempt: 1, kind: "claimed", body: { runner: won[0]!.runner, account: won[0]!.account }, at: 1001 },
		]);
	});

	it("routes by the owner's account preference across online runners", async () => {
		const first = await runner("owner", "first");
		const second = await runner("owner", "second");
		await store.heartbeat(db, first, [account("one")], [], 0);
		await store.heartbeat(db, second, [account("two")], [], 0);
		// The preferred account is on a runner that is not asking for work yet.
		await db.prepare("UPDATE runner_accounts SET rank=0 WHERE id='two'").run();
		const id = await job(10, "owner");
		await store.claim(db, second, 1);
		await db.prepare("UPDATE jobs SET state='queued',attempt=0,runner=NULL,account=NULL WHERE id=?").bind(id).run();
		expect(await store.claim(db, first, 2)).toBeNull();
		expect(await store.claim(db, second, 3)).toMatchObject({ id, runner: second.id, account: "two" });
		// Once the preferred runner stops polling, the next account takes over.
		const other = await job(10, "owner", { target: "issues/1", workflow: "plan" }, 4);
		expect(await store.claim(db, first, 3 + ONLINE + 1)).toMatchObject({ id: other, account: "one" });
	});

	it("keeps untrusted heads, pins, other owners, and paused projects away from unsuitable runners", async () => {
		const mac = await runner("owner", "mac", "darwin");
		const linux = await runner("owner", "linux");
		const vm = await runner("owner", "vm", "linux", true);
		const stranger = await runner("other", "stranger");
		for (const r of [mac, linux, vm, stranger]) await store.heartbeat(db, r, [account("main")], [], 0);
		const untrusted = await job(10, "owner", { workflow: "iterate", target: "pulls/2", trusted: false });
		expect(await store.claim(db, stranger, 1)).toBeNull();
		expect(await store.claim(db, mac, 1)).toBeNull();
		expect(await store.claim(db, linux, 1)).toBeNull();
		expect(await store.claim(db, vm, 1)).toMatchObject({ id: untrusted });

		const pinned = await job(10, "owner", { pinRunner: mac.id, pinAccount: "main" }, 2);
		expect(await store.claim(db, linux, 3)).toBeNull();
		expect(await store.claim(db, mac, 3)).toMatchObject({ id: pinned });
		await expect(job(10, "owner", { target: "x", pinRunner: stranger.id })).rejects.toThrow("Pinned runner");
		await expect(job(10, "owner", { target: "x", pinAccount: "main" })).rejects.toThrow("together");

		await project(10, "owner", "paused");
		await job(10, "owner", { target: "issues/3", workflow: "plan" }, 4);
		expect(await store.claim(db, linux, 5)).toBeNull();
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

	it("reassigns an offline runner's job and fences the returning runner out", async () => {
		const old = await runner("owner", "old");
		const replacement = await runner("owner", "replacement");
		await store.heartbeat(db, old, [account("old")], [], 0);
		const id = await job(10, "owner");
		await store.claim(db, old, 0);
		await store.checkpoint(db, old, id, 1, "Wrote the parser", "session-1", 10);
		// Its lease holds while it renews, even with another runner asking.
		await store.heartbeat(db, replacement, [account("new")], [], LEASE - 1);
		expect(await store.claim(db, replacement, LEASE - 1)).toBeNull();
		expect(await store.claim(db, replacement, LEASE + 11)).toMatchObject({
			id,
			attempt: 2,
			runner: replacement.id,
			// A different runner continues from the summaries, not the old session.
			session: null,
			events: [
				{ kind: "claimed", attempt: 1 },
				{ kind: "summary", attempt: 1, body: "Wrote the parser" },
				{ kind: "claimed", attempt: 2 },
			],
		});
		await expect(store.checkpoint(db, old, id, 1, "Still here", null, LEASE + 12)).rejects.toThrow(
			"no longer current",
		);
		await expect(store.output(db, old, id, 1, "late output", LEASE + 12)).rejects.toThrow("no longer current");
		await expect(
			store.finish(db, old, id, 1, { outcome: "completed", summary: "Done", result: { pr: 1 } }, LEASE + 12),
		).rejects.toThrow("no longer current");
		await expect(store.ask(db, old, id, 1, { summary: "?", session: "s", prompt: {} }, LEASE + 12)).rejects.toThrow(
			"no longer current",
		);
		expect(await store.heartbeat(db, old, [account("old")], [{ job: id, attempt: 1 }], LEASE + 12)).toEqual([
			{ job: id, attempt: 1, action: "stop" },
		]);
		await store.finish(
			db,
			replacement,
			id,
			2,
			{ outcome: "completed", summary: "Done", result: { pr: 1 } },
			LEASE + 13,
		);
		// A retried report is accepted once; the job keeps the replacement's result.
		await store.finish(
			db,
			replacement,
			id,
			2,
			{ outcome: "completed", summary: "Done", result: { pr: 1 } },
			LEASE + 14,
		);
		expect(await state(id)).toMatchObject({ state: "completed", summary: "Done", result: { pr: 1 }, attempt: 2 });
		expect((await state(id)).events.filter((e) => e.kind === "result")).toHaveLength(1);
	});

	it("pauses on a question, accepts one answer, and resumes the same session where it lives", async () => {
		const home = await runner("owner", "home");
		const away = await runner("owner", "away");
		await store.heartbeat(db, home, [account("main")], [], 0);
		await store.heartbeat(db, away, [account("spare")], [], 0);
		const id = await job(10, "owner");
		await store.claim(db, home, 0);
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
		// The other runner waits while the session's runner is online but busy.
		await store.claim(db, away, 5);
		await db.prepare("UPDATE runners SET pollAt=0 WHERE id=?").bind(home.id).run();
		expect(await store.claim(db, away, 6)).toBeNull();
		expect(await store.claim(db, home, 7)).toMatchObject({ id, attempt: 2, session: "session-1" });
	});

	it("pauses an account-limited job with a decision instead of switching accounts", async () => {
		const machine = await runner("owner", "machine");
		await store.heartbeat(db, machine, [account("first"), account("second")], [], 0);
		const id = await job(10, "owner");
		expect(await store.claim(db, machine, 0)).toMatchObject({ account: "first" });
		await store.finish(db, machine, id, 1, { outcome: "limited", summary: "Hit the limit", result: undefined }, 1);
		const paused = await state(id);
		expect(paused).toMatchObject({ state: "waiting", summary: "Hit the limit" });
		expect(paused.questions).toMatchObject([{ kind: "account", prompt: { runner: machine.id, account: "first" } }]);
		expect(await store.claim(db, machine, 2)).toBeNull();
		// Other work avoids the limited account while it is flagged.
		const other = await job(10, "owner", { workflow: "plan", target: "issues/9" }, 3);
		expect(await store.claim(db, machine, 4)).toMatchObject({ id: other, account: "second" });
		await expect(
			store.answer(db, id, paused.questions[0]!.id, "owner", { runner: machine.id, account: "nope" }, 5),
		).rejects.toThrow("owner's accounts");
		await store.answer(db, id, paused.questions[0]!.id, "owner", { runner: machine.id, account: "first" }, 5);
		expect(await state(id)).toMatchObject({
			state: "queued",
			pinRunner: machine.id,
			pinAccount: "first",
			session: null,
		});
		expect(await store.claim(db, machine, 6)).toMatchObject({ id, account: "first", attempt: 2 });
	});

	it("cancels queued work immediately and asks running work to stop with its partial result", async () => {
		const machine = await runner("owner", "machine");
		await store.heartbeat(db, machine, [account("main")], [], 0);
		const queued = await job(10, "owner");
		await store.cancel(db, queued, "owner", 1);
		expect(await state(queued)).toMatchObject({ state: "cancelled" });
		await expect(store.cancel(db, queued, "owner", 2)).rejects.toThrow("already finished");

		const running = await job(10, "owner", {}, 3);
		await store.claim(db, machine, 3);
		await store.cancel(db, running, "owner", 4);
		expect(await store.heartbeat(db, machine, [account("main")], [{ job: running, attempt: 1 }], 5)).toEqual([
			{ job: running, attempt: 1, action: "cancel" },
		]);
		expect(await store.checkpoint(db, machine, running, 1, "Stopping", null, 6)).toEqual({ cancel: true });
		await store.finish(
			db,
			machine,
			running,
			1,
			{ outcome: "cancelled", summary: "Stopped after the parser", result: undefined },
			7,
		);
		expect(await state(running)).toMatchObject({ state: "cancelled", summary: "Stopped after the parser" });

		// A cancelled attempt whose runner vanished stops instead of moving.
		const abandoned = await job(10, "owner", {}, 8);
		await store.claim(db, machine, 8);
		await store.cancel(db, abandoned, "owner", 9);
		expect(await store.claim(db, machine, 9 + LEASE)).toBeNull();
		expect(await state(abandoned)).toMatchObject({ state: "cancelled" });
	});

	it("keeps account preference order and removes accounts a runner stops reporting", async () => {
		const first = await runner("owner", "first");
		const second = await runner("owner", "second");
		await store.heartbeat(db, first, [account("a"), account("b")], [], 0);
		await store.heartbeat(db, second, [account("c")], [], 0);
		await store.heartbeat(db, first, [account("b", true)], [], 1);
		const [one, two] = await store.listRunners(db, "owner", 1);
		expect(one).toMatchObject({ name: "first", online: true, accounts: [{ id: "b", rank: 2, limited: 1 }] });
		expect(two).toMatchObject({ name: "second", accounts: [{ id: "c", rank: 3 }] });
		expect((await store.listRunners(db, "owner", 1 + ONLINE + 1))[0]!.online).toBe(false);
	});

	it("deletes jobs with their project on disconnect", async () => {
		const id = await job(10, "owner");
		await db.prepare("DELETE FROM github_projects WHERE id=10").run();
		expect(await store.readJob(db, id)).toBeNull();
	});
});

describe("runner API", () => {
	function post(path: string, token: string | null, body: unknown) {
		return app.request(
			`${origin}/api/runner${path}`,
			{
				method: "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			testEnv,
		);
	}

	it("requires a registered runner token", async () => {
		expect((await post("/claim", null, {})).status).toBe(401);
		expect((await post("/claim", "x".repeat(43), {})).status).toBe(401);
	});

	it("runs a job through heartbeat, claim, checkpoint, output, and result", async () => {
		const machine = await runner("owner", "machine");
		expect((await post("/claim", machine.token, {})).status).toBe(204);
		expect((await post("/heartbeat", machine.token, { accounts: [{ id: "main" }], attempts: [] })).status).toBe(
			409,
		);
		const beat = await post("/heartbeat", machine.token, { accounts: [account("main")], attempts: [] });
		expect(await beat.json()).toEqual({ attempts: [] });
		const id = await job(10, "owner", {}, Date.now());
		const claimed = await post("/claim", machine.token, {});
		expect(claimed.status).toBe(200);
		const { job: work } = (await claimed.json()) as { job: store.Claimed };
		expect(work).toMatchObject({ id, attempt: 1, revision: commit, branch: "quest/first", owner: "upstream" });
		expect((await post(`/jobs/${id}/checkpoint`, machine.token, { attempt: 1, summary: "Halfway" })).status).toBe(
			200,
		);
		expect((await post(`/jobs/${id}/output`, machine.token, { attempt: 1, text: "raw log" })).status).toBe(204);
		expect(
			(await post(`/jobs/${id}/checkpoint`, machine.token, { attempt: 2, summary: "Wrong attempt" })).status,
		).toBe(409);
		expect(
			(await post(`/jobs/${id}/result`, machine.token, { attempt: 1, outcome: "done", summary: "x" })).status,
		).toBe(409);
		expect((await post(`/jobs/${id}/result`, machine.token, { attempt: 1, outcome: "completed" })).status).toBe(
			409,
		);
		expect(
			(await post(`/jobs/${id}/result`, machine.token, { attempt: 1, outcome: "completed", summary: "Done" }))
				.status,
		).toBe(204);
		expect(await store.readOutput(db, id)).toMatchObject([{ attempt: 1, text: "raw log" }]);
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
		await store.heartbeat(db, machine, [account("main")], [], Date.now());
		const { id } = (await (await post("", { workflow: "start", target: "quest/first.md" })).json()) as {
			id: string;
		};
		await store.claim(db, machine, Date.now());
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
