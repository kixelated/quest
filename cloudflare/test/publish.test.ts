import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { refusal, restart, validPath } from "../src/jobs/publish";
import * as store from "../src/jobs/store";
import { privateKey } from "./github-key";
import { origin } from "./login-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
const revision = "a".repeat(40);
const prHead = "b".repeat(40);
const user = "publisher";
const githubUser = 7171;
const upstream = { owner: "upstream", name: "project", id: 10 };

type Request = { method: string; path: string; body: any; token: string | null };
type Commit = { parents: string[]; tree: string; message: string };

/** A stateful stand-in for the parts of GitHub's API that publication uses. */
function fakeGitHub() {
	let next = 1;
	const oid = () => (next++).toString(16).padStart(40, "c");
	const commits = new Map<string, Commit>([
		[revision, { parents: [], tree: "e".repeat(40), message: "base" }],
		[prHead, { parents: [revision], tree: "e".repeat(40), message: "pr" }],
	]);
	const trees = new Map<string, { base: string; entries: any[] }>();
	const refs = new Map<string, string>();
	const pulls: any[] = [];
	const requests: Request[] = [];
	const fake = {
		requests,
		refs,
		commits,
		trees,
		pulls,
		role: "maintain",
		forkParent: 10,
		/** The iterated pull request's head repository. */
		head: { id: 10, name: "project", owner: { login: "upstream" } } as any,
		/** Apply the next ref update, then fail as if the response were lost. */
		loseMove: false,
		/** GitHub's clock, for pull request creation times. */
		now: 0,
		/** Runs while a branch is created, as if the job changed meanwhile. */
		onCreate: null as null | (() => Promise<unknown>),
	};
	const repos: Record<string, any> = {
		"upstream/project": { id: 10, fork: false, default_branch: "main" },
		"quest-bot-forks/project": { id: 20, fork: true, default_branch: "main" },
	};
	function ancestor(of: string, sha: string): boolean {
		if (of === sha) return true;
		return (commits.get(sha)?.parents ?? []).some((parent) => ancestor(of, parent));
	}
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = new URL(String(input));
		const path = url.pathname;
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		const token = new Headers(init?.headers).get("Authorization");
		requests.push({ method, path, body, token });
		const json = (value: unknown, status = 200) => Response.json(value, { status });
		const repo = path.match(/^\/repos\/([^/]+\/[^/]+)/)?.[1];
		const rest = repo ? path.slice(`/repos/${repo}`.length) : path;
		if (rest === "/installation")
			return json({
				id: repo!.startsWith("quest-bot-forks/") ? 6 : 5,
				app_id: 123,
				suspended_at: null,
				permissions: { metadata: "read", contents: "write", pull_requests: "write" },
			});
		if (path.endsWith("/access_tokens"))
			return json({ token: path.includes("/6/") ? "fork-token" : "upstream-token" });
		if (path === "/installation/token") return new Response(null, { status: 204 });
		if (path === `/user/${githubUser}`) return json({ id: githubUser, login: "maintainer" });
		if (rest.endsWith("/permission"))
			return json({ user: { id: githubUser }, permission: "write", role_name: fake.role });
		if (path === "/graphql") {
			const pull = pulls.find((p) => p.node_id === body.variables.id);
			if (!pull || !body.query.includes("markPullRequestReadyForReview")) return json({ errors: [{}] });
			pull.draft = false;
			return json({ data: {} });
		}
		if (!repo || !repos[repo]) throw new Error(`Unexpected request: ${method} ${path}`);
		if (rest === "") {
			const [owner, name] = repo.split("/");
			return json({
				...repos[repo],
				name,
				owner: { login: owner },
				private: false,
				visibility: "public",
				archived: false,
				disabled: false,
				parent: repos[repo].fork ? { id: fake.forkParent } : undefined,
			});
		}
		const ref = rest.match(/^\/git\/refs?\/heads\/(.+)$/)?.[1];
		if (ref && method === "GET") {
			const sha = refs.get(`${repo}:${decodeURIComponent(ref)}`);
			return sha ? json({ object: { type: "commit", sha } }) : json({}, 404);
		}
		const commit = rest.match(/^\/git\/commits\/([a-f0-9]{40})$/)?.[1];
		if (commit) return commits.has(commit) ? json({ tree: { sha: commits.get(commit)!.tree } }) : json({}, 404);
		if (rest === "/git/blobs") return json({ sha: oid() });
		if (rest === "/git/trees") {
			const sha = oid();
			trees.set(sha, { base: body.base_tree, entries: body.tree });
			return json({ sha });
		}
		if (rest === "/git/commits") {
			const sha = oid();
			commits.set(sha, { parents: body.parents, tree: body.tree, message: body.message });
			return json({ sha });
		}
		if (rest === "/git/refs" && method === "POST") {
			const key = `${repo}:${body.ref.slice("refs/heads/".length)}`;
			if (refs.has(key)) return json({ message: "Reference already exists" }, 422);
			refs.set(key, body.sha);
			await fake.onCreate?.();
			return json({ object: { sha: body.sha } }, 201);
		}
		if (ref && method === "PATCH") {
			const key = `${repo}:${decodeURIComponent(ref)}`;
			const current = refs.get(key);
			if (!current) return json({ message: "Reference does not exist" }, 422);
			if (!body.force && !ancestor(current, body.sha))
				return json({ message: "Update is not a fast forward" }, 422);
			refs.set(key, body.sha);
			if (fake.loseMove) {
				fake.loseMove = false;
				return json({}, 502);
			}
			return json({ object: { sha: body.sha } });
		}
		if (repo === "upstream/project" && rest === "/pulls" && method === "GET") {
			const head = url.searchParams.get("head");
			const state = url.searchParams.get("state") ?? "open";
			return json(
				pulls
					.filter(
						(pull) =>
							(state === "all" || pull.state === state) &&
							`${pull.head.repo.owner.login}:${pull.head.ref}` === head,
					)
					.reverse(),
			);
		}
		if (repo === "upstream/project" && rest === "/pulls" && method === "POST") {
			const [owner, branch] = body.head.split(":");
			if (pulls.some((pull) => pull.state === "open" && pull.head.ref === branch))
				return json({ message: "A pull request already exists" }, 422);
			const pull = {
				number: 100 + pulls.length,
				node_id: `PR_${pulls.length}`,
				html_url: `https://github.com/upstream/project/pull/${100 + pulls.length}`,
				state: "open",
				created_at: new Date(fake.now).toISOString(),
				draft: body.draft,
				title: body.title,
				body: body.body,
				base: body.base,
				maintainer_can_modify: body.maintainer_can_modify,
				head: {
					ref: branch,
					sha: refs.get(`quest-bot-forks/project:${branch}`),
					repo: { id: 20, name: "project", owner: { login: owner } },
				},
			};
			pulls.push(pull);
			return json(pull, 201);
		}
		const number = Number(rest.match(/^\/pulls\/(\d+)$/)?.[1]);
		if (repo === "upstream/project" && number === 2)
			return json({ number: 2, state: "open", head: { ref: "contributor/fix", sha: prHead, repo: fake.head } });
		const pull = pulls.find((p) => p.number === number);
		if (pull && method === "GET") return json(pull);
		if (pull && method === "PATCH") return json(Object.assign(pull, body));
		throw new Error(`Unexpected request: ${method} ${path}`);
	});
	return fake;
}

let github: ReturnType<typeof fakeGitHub>;
let machine: store.Runner & { token: string };

/** Create and claim a job on the test runner, returning its ID. */
async function running(extra: Partial<store.NewJob> = {}, now = 0) {
	const { id } = await store.createJob(
		db,
		{
			repository: 10,
			actor: user,
			workflow: "start",
			target: "quest/first.md",
			revision,
			branch: "quest/first",
			trusted: true,
			...extra,
		},
		now,
	);
	await store.dispatch(db, user, new Map([[machine.id, 1]]), now);
	return id;
}
/** Fail a job's current attempt, as its runner would. */
async function fail(id: string) {
	await store.finish(db, machine, id, 1, { outcome: "failed", summary: "Failed", result: undefined }, 0);
}
async function publish(body: Record<string, unknown>, token = machine.token) {
	const text = JSON.stringify(body);
	const ctx = createExecutionContext();
	const response = await app.request(
		`${origin}/api/runner/publish`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Content-Length": String(new TextEncoder().encode(text).length),
			},
			body: text,
		},
		testEnv,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}
const file = (path: string, content: string, executable?: boolean) => ({
	path,
	content: Buffer.from(content).toString("base64"),
	...(executable === undefined ? {} : { executable }),
});
const gitWrites = () => github.requests.filter((r) => r.path.includes("/git/") && r.method !== "GET");
async function job(id: string) {
	return (await store.readJob(db, id))!;
}

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
		db
			.prepare("INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)")
			.bind(user, user, `${user}@example.test`),
		db
			.prepare(
				"INSERT OR IGNORE INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,'github',?,0,0)",
			)
			.bind(`${user}-account`, String(githubUser), user),
		db
			.prepare(
				"INSERT INTO github_projects(id,owner,name,installation,state,enrolledBy,updatedAt) VALUES(10,'upstream','project',5,'enabled',?,0)",
			)
			.bind(user),
	]);
	const { id, token } = await store.createRunner(db, user, "machine", "linux", true, 0);
	machine = { id, token, owner: user, name: "machine", platform: "linux", vm: 1 };
	await store.report(
		db,
		machine,
		[{ id: "main", provider: "anthropic", kind: "subscription", label: "main", limited: false }],
		[],
		0,
	);
	github = fakeGitHub();
});
afterEach(() => vi.restoreAllMocks());

describe("publication policy", () => {
	it("accepts work-tree paths only", () => {
		for (const path of ["src/a.ts", "quest/m0/one.md", ".github/CODEOWNERS", "a/.gitignore"])
			expect(validPath(path)).toBe(true);
		for (const path of [
			"",
			"/abs",
			"a//b",
			"a/",
			"../up",
			"a/./b",
			".git/config",
			"x/.GIT/hooks/pre-commit",
			"a\\b",
			"a\nb",
		])
			expect(validPath(path)).toBe(false);
	});
	it("limits each workflow to the changes it may publish", () => {
		expect(refusal("plan", "quest/m0/one.md")).toBeNull();
		expect(refusal("plan", "src/index.ts")).toContain("quest files");
		for (const path of ["quest/tool.sh", "quest/AGENTS.md", "quest/m0/CLAUDE.md"])
			expect(refusal("plan", path)).toContain("quest files");
		expect(refusal("bootstrap", "flake.nix")).toBeNull();
		expect(refusal("bootstrap", "flake.lock")).toBeNull();
		expect(refusal("bootstrap", "justfile")).toContain("flake");
		expect(refusal("start", "src/index.ts")).toBeNull();
		for (const workflow of ["plan", "start", "iterate", "bootstrap"] as const)
			expect(refusal(workflow, ".github/workflows/ci.yml")).toContain("workflows permission");
	});
});

describe("runner publication", () => {
	it("commits to the job's service fork branch and opens one draft pull request as the App", async () => {
		const id = await running();
		const first = await publish({
			job: id,
			attempt: 1,
			head: null,
			message: "feat: first",
			changes: [
				file("src/first.ts", "export {};\n"),
				file("scripts/run.sh", "#!/bin/sh\n", true),
				{ path: "logo.bin", content: Buffer.from([0, 1, 2, 255]).toString("base64") },
				{ ...file("latest", "scripts/run.sh"), symlink: true },
				{ path: "quest/first.md", content: null },
			],
		});
		expect(first.status).toBe(200);
		const { head } = (await first.json()) as { head: string };
		expect(github.refs.get("quest-bot-forks/project:quest/first")).toBe(head);
		expect(github.commits.get(head)).toMatchObject({ parents: [revision], message: "feat: first" });
		// No author or committer: GitHub attributes the commit to the App.
		const created = github.requests.find((r) => r.path.endsWith("/git/commits") && r.method === "POST")!;
		expect(Object.keys(created.body).sort()).toEqual(["message", "parents", "tree"]);
		const tree = github.trees.get(github.commits.get(head)!.tree)!;
		expect(tree.base).toBe("e".repeat(40));
		expect(tree.entries).toEqual([
			{ path: "src/first.ts", mode: "100644", type: "blob", content: "export {};\n" },
			{ path: "scripts/run.sh", mode: "100755", type: "blob", content: "#!/bin/sh\n" },
			{ path: "logo.bin", mode: "100644", type: "blob", sha: expect.stringMatching(/^[a-f0-9]{40}$/) },
			{ path: "latest", mode: "120000", type: "blob", content: "scripts/run.sh" },
			{ path: "quest/first.md", mode: "100644", type: "blob", sha: null },
		]);
		// Every Git write uses the fork-scoped token; the upstream token is read-only metadata.
		expect(
			gitWrites().every((r) => r.token === "Bearer fork-token" && r.path.startsWith("/repos/quest-bot-forks/")),
		).toBe(true);
		const scopes = github.requests.filter((r) => r.path.endsWith("/access_tokens")).map((r) => r.body);
		expect(scopes).toEqual([
			{ repository_ids: [10], permissions: { metadata: "read" } },
			{ repositories: ["project"], permissions: { metadata: "read", contents: "write" } },
		]);
		expect((await job(id)).head).toBe(head);

		// A stale base is refused without writing anything.
		const before = gitWrites().length;
		const stale = await publish({ job: id, attempt: 1, head: null, message: "again", changes: [file("a", "a")] });
		expect(stale.status).toBe(409);
		expect(await stale.json()).toEqual({ error: `The job's branch is at ${head}; continue from it` });
		expect(gitWrites()).toHaveLength(before);

		const second = await publish({
			job: id,
			attempt: 1,
			head,
			message: "feat: more",
			changes: [file("src/second.ts", "export {};\n")],
			pull: { title: "Start first", body: "Summary\n\n(written by Test Model)" },
		});
		expect(second.status).toBe(200);
		const delivered = (await second.json()) as { head: string; pull: { number: number; draft: boolean } };
		expect(github.commits.get(delivered.head)!.parents).toEqual([head]);
		expect(delivered.pull).toMatchObject({ number: 100, draft: true });
		expect(github.pulls).toEqual([
			expect.objectContaining({
				title: "Start first",
				base: "main",
				draft: true,
				maintainer_can_modify: false,
				head: expect.objectContaining({ ref: "quest/first", repo: expect.objectContaining({ id: 20 }) }),
			}),
		]);
		const create = github.requests.find((r) => r.path === "/repos/upstream/project/pulls" && r.method === "POST")!;
		expect(create.token).toBe("Bearer upstream-token");
		expect(create.body).toMatchObject({ head: "quest-bot-forks:quest/first", head_repo: "project" });

		// Delivering again updates the same pull request and marks finished work ready.
		const ready = await publish({
			job: id,
			attempt: 1,
			head: delivered.head,
			pull: { title: "Start first", body: "Done", draft: false },
		});
		expect(await ready.json()).toMatchObject({ pull: { number: 100, draft: false } });
		expect(github.pulls).toHaveLength(1);
		expect(github.pulls[0].body).toBe("Done");
		expect(github.requests.filter((r) => r.path === "/graphql").map((r) => r.body.variables)).toEqual([
			{ id: "PR_0" },
		]);
		expect((await job(id)).pull).toBe(100);
	});

	it("fences out an attempt that no longer owns the job", async () => {
		const id = await running();
		await db.prepare("UPDATE jobs SET attempt=2 WHERE id=?").bind(id).run();
		const response = await publish({ job: id, attempt: 1, head: null, message: "late", changes: [file("a", "a")] });
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Attempt is no longer current" });
		expect(github.requests).toEqual([]);
		expect(
			(
				await publish(
					{ job: id, attempt: 2, head: null, message: "m", changes: [file("a", "a")] },
					"x".repeat(43),
				)
			).status,
		).toBe(401);
	});

	it("rechecks the requester's maintainer authority before writing", async () => {
		const id = await running();
		github.role = "write";
		const response = await publish({ job: id, attempt: 1, head: null, message: "m", changes: [file("a", "a")] });
		expect(response.status).toBe(403);
		expect(gitWrites()).toEqual([]);
	});

	it("pauses on a decision instead of dropping changes the workflow may not publish", async () => {
		const id = await running({ workflow: "plan", target: "issues/1", branch: "plan/issue-1" });
		const response = await publish({
			job: id,
			attempt: 1,
			head: null,
			session: "s1",
			message: "docs: plan",
			changes: [
				file("quest/one.md", "# [S] One\n"),
				file("src/index.ts", "x"),
				file(".github/workflows/ci.yml", "x"),
			],
		});
		expect(response.status).toBe(202);
		const { decision } = (await response.json()) as { decision: string };
		const paused = await job(id);
		expect(paused).toMatchObject({ state: "waiting", session: "s1", head: null });
		expect(paused.questions).toEqual([
			expect.objectContaining({
				id: decision,
				kind: "publication",
				prompt: {
					type: "publication",
					refused: [
						{ path: "src/index.ts", reason: "Planning publishes only quest files" },
						{ path: ".github/workflows/ci.yml", reason: expect.stringContaining("workflows permission") },
					],
				},
			}),
		]);
		expect(github.requests).toEqual([]);
		// The answer requeues the job, which resumes its session.
		await store.answer(db, id, decision, user, "Drop the source change", 1);
		expect(await job(id)).toMatchObject({ state: "queued" });
	});

	it("opens planning pull requests as drafts and bootstraps only flake files", async () => {
		const plan = await running({ workflow: "plan", target: "issues/1", branch: "plan/issue-1" });
		const response = await publish({
			job: plan,
			attempt: 1,
			head: null,
			message: "docs: plan",
			changes: [file("quest/one.md", "# [S] One\n")],
			pull: { title: "Plan", body: "Decisions", draft: false },
		});
		expect(await response.json()).toMatchObject({ pull: { draft: true } });
		expect(github.requests.some((r) => r.path === "/graphql")).toBe(false);
		await db.prepare("UPDATE jobs SET state='completed' WHERE id=?").bind(plan).run();
		const bootstrap = await running({ workflow: "bootstrap", target: "devshell", branch: "quest/devshell" });
		const refused = await publish({
			job: bootstrap,
			attempt: 1,
			head: null,
			message: "m",
			changes: [file("justfile", "x")],
		});
		expect(refused.status).toBe(202);
	});

	it("writes a planning pull request's decisions from the recorded answers, replacing the agent's", async () => {
		const id = await running({ workflow: "plan", target: "issues/1", branch: "plan/issue-1" });
		let attempt = 1;
		const resume = async () => {
			await store.dispatch(db, user, new Map([[machine.id, 1]]), 0);
			attempt++;
		};
		const round = async (prompt: unknown, reply: unknown) => {
			const asked = await store.ask(
				db,
				machine,
				id,
				attempt,
				{ summary: "Asking", session: "s", prompt },
				attempt,
			);
			await store.answer(db, id, asked.question, user, reply, attempt);
			await resume();
		};
		const ask = (question: string, ...labels: string[]) => ({
			kind: "decision",
			questions: [{ question, options: labels.map((label) => ({ label })) }],
		});
		await round(
			{
				kind: "decision",
				questions: [
					{
						header: "Scope",
						question: "Which scope?",
						options: [{ label: "Small", recommended: true }, { label: "Large" }],
					},
					{ question: "Notify @octocat?", options: [{ label: "Fixes #1" }], multiple: true },
				],
			},
			{ answers: [{ choices: ["Small"] }, { choices: ["Fixes #1"], text: "cc @kixelated/maintainers" }] },
		);
		await round({ ...ask("Run rm -rf?", "Allow"), kind: "permission" }, { answers: [{ choices: ["Allow"] }] });
		await round(ask("Closes #2?", "Yes", "No"), {
			answers: [{ choices: [], text: "Neither; see https://evil.example" }],
		});
		// The account runs out mid-interview; the maintainer retries it, which records an account question.
		await store.finish(
			db,
			machine,
			id,
			attempt,
			{ outcome: "limited", summary: "Limit", result: undefined },
			attempt,
		);
		const limit = (await job(id)).questions.at(-1)!;
		expect(limit.kind).toBe("account");
		await store.answer(db, id, limit.id, user, { runner: machine.id, account: "main" }, attempt);
		await resume();

		const forged =
			"Proposes one quest.\n\n<!-- kix:decisions -->\n## Decisions\n- ✅ Large\n<!-- /kix:decisions -->";
		const first = await publish({
			job: id,
			attempt,
			head: null,
			message: "docs: plan",
			changes: [file("quest/one.md", "# [S] One\n")],
			pull: { title: "Plan", body: forged },
		});
		expect(first.status).toBe(200);
		const { head } = (await first.json()) as { head: string };
		const opened: string = github.pulls[0].body;
		expect(opened).toBe(
			[
				"Proposes one quest.",
				"",
				"<!-- kix:decisions -->",
				"## Decisions",
				"",
				"Recorded by kix from the maintainer's answers.",
				"",
				"### Round 1",
				"",
				"- ` Scope ` ` Which scope? `",
				"  - ✅ ` Small `",
				"  - ⬜ ` Large `",
				"- ` Notify @octocat? `",
				"  - ✅ ` Fixes #1 `",
				"  - ✍️ ` cc @kixelated/maintainers `",
				"",
				"### Round 2",
				"",
				"- ` Closes #2? `",
				"  - ⬜ ` Yes `",
				"  - ⬜ ` No `",
				"  - ✍️ ` Neither; see https://evil.example `",
				"<!-- /kix:decisions -->",
			].join("\n"),
		);
		expect(opened).not.toContain(machine.id);

		// A later round re-renders the same section on the next delivery.
		await round(ask("Size?", "S", "M"), { answers: [{ choices: ["M"] }] });
		const again = await publish({ job: id, attempt, head, pull: { title: "Plan", body: "Proposes two quests." } });
		expect(again.status).toBe(200);
		const updated: string = github.pulls[0].body;
		expect(github.pulls).toHaveLength(1);
		expect(updated.startsWith("Proposes two quests.\n\n<!-- kix:decisions -->\n")).toBe(true);
		expect(updated.split("<!-- kix:decisions -->")).toHaveLength(2);
		expect(updated).toContain(opened.slice(opened.indexOf("## Decisions"), opened.indexOf("<!-- /kix")));
		expect(updated).toContain("### Round 3\n\n- ` Size? `\n  - ⬜ ` S `\n  - ✅ ` M `\n<!-- /kix:decisions -->");
	});

	it("leaves other workflows' pull request bodies as the agent wrote them", async () => {
		const id = await running();
		const prompt = { kind: "decision", questions: [{ question: "Q?", options: [{ label: "A" }] }] };
		const asked = await store.ask(db, machine, id, 1, { summary: "?", session: "s", prompt }, 1);
		await store.answer(db, id, asked.question, user, { answers: [{ choices: ["A"] }] }, 1);
		await store.dispatch(db, user, new Map([[machine.id, 1]]), 0);
		const body = "Summary <!-- kix:decisions --> left alone";
		const response = await publish({
			job: id,
			attempt: 2,
			head: null,
			message: "feat: first",
			changes: [file("src/first.ts", "export {};\n")],
			pull: { title: "First", body },
		});
		expect(response.status).toBe(200);
		expect(github.pulls[0].body).toBe(body);
	});

	it("recovers a branch update whose outcome was lost, without overwriting or duplicating", async () => {
		const id = await running();
		github.loseMove = false;
		const first = (await (
			await publish({ job: id, attempt: 1, head: null, message: "one", changes: [file("a", "1")] })
		).json()) as { head: string };
		github.loseMove = true;
		const lost = await publish({
			job: id,
			attempt: 1,
			head: first.head,
			message: "two",
			changes: [file("a", "2")],
		});
		expect(lost.status).toBe(403);
		const landed = github.refs.get("quest-bot-forks/project:quest/first")!;
		expect(landed).not.toBe(first.head);
		expect(await job(id)).toMatchObject({ head: first.head, pending: landed });
		// The next publication finds the pending commit on the branch and adopts it.
		const retry = await publish({
			job: id,
			attempt: 1,
			head: first.head,
			message: "two",
			changes: [file("a", "2")],
		});
		expect(await retry.json()).toEqual({ error: `The job's branch is at ${landed}; continue from it` });
		expect(await job(id)).toMatchObject({ head: landed, pending: null });
		const next = await publish({ job: id, attempt: 1, head: landed, message: "three", changes: [file("a", "3")] });
		expect(next.status).toBe(200);
	});

	it("refuses a write when the branch moved outside the job, and never overwrites it", async () => {
		const id = await running();
		const { head } = (await (
			await publish({ job: id, attempt: 1, head: null, message: "one", changes: [file("a", "1")] })
		).json()) as { head: string };
		github.refs.set("quest-bot-forks/project:quest/first", prHead);
		const response = await publish({
			job: id,
			attempt: 1,
			head,
			session: "s",
			message: "two",
			changes: [file("a", "2")],
		});
		expect(response.status).toBe(202);
		expect((await job(id)).questions[0]).toMatchObject({
			kind: "publication",
			prompt: { blocked: "The branch quest/first changed outside this job." },
		});
		expect(github.refs.get("quest-bot-forks/project:quest/first")).toBe(prHead);
	});

	it("asks before reusing a branch that earlier work left on the fork", async () => {
		github.refs.set("quest-bot-forks/project:quest/first", prHead);
		const id = await running();
		const response = await publish({
			job: id,
			attempt: 1,
			head: null,
			session: "s",
			message: "m",
			changes: [file("a", "1")],
		});
		expect(response.status).toBe(202);
		expect((await job(id)).questions[0]!.prompt).toEqual({
			type: "publication",
			blocked: expect.stringContaining("already has the branch quest/first"),
			restart: true,
		});
	});

	it("starts over from the job's revision, resetting its fork branch and adopting its open pull request", async () => {
		const id = await running();
		const { head } = (await (
			await publish({
				job: id,
				attempt: 1,
				head: null,
				message: "one",
				changes: [file("a", "1")],
				pull: { title: "T", body: "B" },
			})
		).json()) as { head: string };
		github.refs.set("quest-bot-forks/project:quest/first", prHead);
		const blocked = await publish({
			job: id,
			attempt: 1,
			head,
			session: "s",
			message: "two",
			changes: [file("a", "2")],
		});
		expect(blocked.status).toBe(202);
		const waiting = await job(id);
		const question = waiting.questions[0]!.id;

		const created = await restart(testEnv, user, upstream, waiting, question);
		expect(github.refs.get("quest-bot-forks/project:quest/first")).toBe(revision);
		expect((await job(id)).state).toBe("cancelled");
		expect((await job(id)).questions[0]!.answer).toEqual(store.RESTART);
		expect(await job(created)).toMatchObject({ state: "queued", head: revision, pull: null, continues: null });
		await expect(restart(testEnv, user, upstream, await job(id), question)).rejects.toThrow("can start over");

		// The new job publishes on the reset branch and keeps the pull request, still open.
		await store.dispatch(db, user, new Map([[machine.id, 1]]), 1000);
		const response = await publish({
			job: created,
			attempt: 1,
			head: revision,
			message: "again",
			changes: [file("a", "3")],
			pull: { title: "T", body: "B" },
		});
		expect(response.status).toBe(200);
		const next = (await response.json()) as { head: string; pull: { number: number } };
		expect(github.commits.get(next.head)!.parents).toEqual([revision]);
		expect(next.pull.number).toBe(100);
		expect(github.pulls).toHaveLength(1);
	});

	it("never offers to start over an iterated pull request's head", async () => {
		const id = await running({
			workflow: "iterate",
			target: "pulls/2",
			revision: prHead,
			branch: "contributor/fix",
			trusted: false,
		});
		github.refs.set("upstream/project:contributor/fix", revision);
		const blocked = await publish({
			job: id,
			attempt: 1,
			head: prHead,
			session: "s",
			message: "m",
			changes: [file("a", "1")],
		});
		expect(blocked.status).toBe(202);
		const waiting = await job(id);
		expect(waiting.questions[0]!.prompt).toEqual({
			type: "publication",
			blocked: "The branch contributor/fix changed outside this job.",
		});
		await expect(restart(testEnv, user, upstream, waiting, waiting.questions[0]!.id)).rejects.toThrow(
			"can start over",
		);
		expect(github.refs.get("upstream/project:contributor/fix")).toBe(revision);
	});

	it("reconciles an interrupted delivery with the pull request it already opened", async () => {
		const id = await running();
		const { head } = (await (
			await publish({
				job: id,
				attempt: 1,
				head: null,
				message: "one",
				changes: [file("a", "1")],
				pull: { title: "T", body: "B" },
			})
		).json()) as { head: string };
		await db.prepare("UPDATE jobs SET pull=NULL WHERE id=?").bind(id).run();
		const again = await publish({ job: id, attempt: 1, head, pull: { title: "T", body: "B2" } });
		expect(await again.json()).toMatchObject({ pull: { number: 100 } });
		expect(github.pulls).toHaveLength(1);
		// A pull request the maintainer closed is not replaced.
		github.pulls[0].state = "closed";
		const closed = await publish({ job: id, attempt: 1, head, pull: { title: "T", body: "B3" } });
		expect(closed.status).toBe(403);
		expect(await closed.json()).toEqual({ error: expect.stringContaining("was closed") });
		// Nor is one closed after a delivery whose outcome went unrecorded.
		await db.prepare("UPDATE jobs SET pull=NULL WHERE id=?").bind(id).run();
		const unrecorded = await publish({ job: id, attempt: 1, head, pull: { title: "T", body: "B3" } });
		expect(await unrecorded.json()).toEqual({ error: expect.stringContaining("was closed") });
		expect(github.pulls).toHaveLength(1);
	});

	it("opens a new pull request when only earlier work's closed one shares the branch", async () => {
		github.pulls.push({
			number: 99,
			state: "closed",
			created_at: new Date(0).toISOString(),
			head: {
				ref: "quest/first",
				sha: prHead,
				repo: { id: 20, name: "project", owner: { login: "quest-bot-forks" } },
			},
		});
		const id = await running();
		await db.prepare("UPDATE jobs SET createdAt=5000 WHERE id=?").bind(id).run();
		github.now = 6000;
		const response = await publish({
			job: id,
			attempt: 1,
			head: null,
			message: "m",
			changes: [file("a", "1")],
			pull: { title: "T", body: "B" },
		});
		expect(await response.json()).toMatchObject({ pull: { number: 101 } });
	});

	it("rechecks the attempt and its cancellation after writing the branch, before delivering", async () => {
		const stopped = await running();
		github.onCreate = () => db.prepare("UPDATE jobs SET cancel=1 WHERE id=?").bind(stopped).run();
		const changes = [file("a", "1")];
		const pull = { title: "T", body: "B", draft: false };
		const draft = await publish({ job: stopped, attempt: 1, head: null, message: "m", changes, pull });
		expect(await draft.json()).toMatchObject({ pull: { draft: true } });
		await db.prepare("UPDATE jobs SET state='completed' WHERE id=?").bind(stopped).run();
		const ended = await running({ target: "quest/second.md", branch: "quest/second" });
		github.onCreate = () => db.prepare("UPDATE jobs SET state='completed' WHERE id=?").bind(ended).run();
		const late = await publish({ job: ended, attempt: 1, head: null, message: "m", changes, pull });
		expect(await late.json()).toEqual({ error: "Attempt is no longer current" });
		expect(github.pulls).toHaveLength(1);
	});

	it("pauses a delivery alone when the branch moved outside the job", async () => {
		const id = await running();
		const { head } = (await (
			await publish({ job: id, attempt: 1, head: null, message: "one", changes: [file("a", "1")] })
		).json()) as { head: string };
		github.refs.set("quest-bot-forks/project:quest/first", prHead);
		const response = await publish({ job: id, attempt: 1, head, session: "s", pull: { title: "T", body: "B" } });
		expect(response.status).toBe(202);
		expect((await job(id)).questions[0]).toMatchObject({
			kind: "publication",
			prompt: { blocked: "The branch quest/first changed outside this job." },
		});
		expect(github.pulls).toEqual([]);
	});

	it("continues a retried job from the branch and pull request its failed job published", async () => {
		const failed = await running();
		const { head } = (await (
			await publish({
				job: failed,
				attempt: 1,
				head: null,
				message: "one",
				changes: [file("a", "1")],
				pull: { title: "T", body: "B" },
			})
		).json()) as { head: string };
		await fail(failed);
		const id = await running({}, 1000);
		expect(await job(id)).toMatchObject({ state: "running", head, pull: 100 });
		const response = await publish({
			job: id,
			attempt: 1,
			head,
			message: "two",
			changes: [file("a", "2")],
			pull: { title: "T", body: "B2" },
		});
		expect(response.status).toBe(200);
		const next = (await response.json()) as { head: string; pull: { number: number } };
		expect(github.commits.get(next.head)!.parents).toEqual([head]);
		expect(github.refs.get("quest-bot-forks/project:quest/first")).toBe(next.head);
		expect(next.pull.number).toBe(100);
		expect(github.pulls).toHaveLength(1);
	});

	it("keeps a failed planning job's decisions in the pull request its retry continues", async () => {
		const target = { workflow: "plan" as const, target: "issues/1", branch: "plan/issue-1" };
		const decide = async (id: string, question: string, choice: string) => {
			const prompt = { kind: "decision", questions: [{ question, options: [{ label: choice }] }] };
			const asked = await store.ask(db, machine, id, 1, { summary: "?", session: "s", prompt }, 1);
			await store.answer(db, id, asked.question, user, { answers: [{ choices: [choice] }] }, 1);
			await store.dispatch(db, user, new Map([[machine.id, 1]]), 0);
		};
		const failed = await running(target);
		await decide(failed, "First?", "A");
		const pull = { title: "Plan", body: "Plan" };
		const changes = [file("quest/a.md", "# A\n")];
		const first = await publish({ job: failed, attempt: 2, head: null, message: "m", changes, pull });
		const { head } = (await first.json()) as { head: string };
		await store.finish(db, machine, failed, 2, { outcome: "failed", summary: "Failed", result: undefined }, 2);

		const retry = await running(target, 1000);
		await decide(retry, "Second?", "B");
		const response = await publish({ job: retry, attempt: 2, head, pull });
		expect(response.status).toBe(200);
		expect(github.pulls).toHaveLength(1);
		const body: string = github.pulls[0].body;
		expect(body).toContain("### Round 1\n\n- ` First? `\n  - ✅ ` A `");
		expect(body).toContain("### Round 2\n\n- ` Second? `\n  - ✅ ` B `");
	});

	it("keeps the decisions of every failed job a retry continues, even one that opened no pull request", async () => {
		const target = { workflow: "plan" as const, target: "issues/1", branch: "plan/issue-1" };
		const decide = async (id: string, question: string, choice: string) => {
			const prompt = { kind: "decision", questions: [{ question, options: [{ label: choice }] }] };
			const asked = await store.ask(db, machine, id, 1, { summary: "?", session: "s", prompt }, 1);
			await store.answer(db, id, asked.question, user, { answers: [{ choices: [choice] }] }, 1);
			await store.dispatch(db, user, new Map([[machine.id, 1]]), 0);
		};
		const changes = [file("quest/a.md", "# A\n")];
		// The first job pushes commits but fails before opening a pull request.
		const first = await running(target);
		await decide(first, "First?", "A");
		const pushed = await publish({ job: first, attempt: 2, head: null, message: "m", changes });
		const { head } = (await pushed.json()) as { head: string };
		await store.finish(db, machine, first, 2, { outcome: "failed", summary: "Failed", result: undefined }, 2);
		// So does its retry, which publishes nothing.
		const second = await running(target, 1000);
		expect(await job(second)).toMatchObject({ continues: first, head, pull: null });
		await decide(second, "Second?", "B");
		await store.finish(db, machine, second, 2, { outcome: "failed", summary: "Failed", result: undefined }, 2);

		const third = await running(target, 2000);
		expect((await job(third)).continues).toBe(second);
		const response = await publish({ job: third, attempt: 1, head, pull: { title: "Plan", body: "Plan" } });
		expect(response.status).toBe(200);
		const body: string = github.pulls[0].body;
		expect(body).toContain("### Round 1\n\n- ` First? `\n  - ✅ ` A `");
		expect(body).toContain("### Round 2\n\n- ` Second? `\n  - ✅ ` B `");
		// A new job on the target after one that did not fail continues nothing.
		await db.prepare("UPDATE jobs SET state='completed' WHERE id=?").bind(third).run();
		expect((await job(await running(target, 3000))).continues).toBeNull();
	});

	it("adopts the open pull request a failed job opened without recording it", async () => {
		const failed = await running();
		const { head } = (await (
			await publish({
				job: failed,
				attempt: 1,
				head: null,
				message: "one",
				changes: [file("a", "1")],
				pull: { title: "T", body: "B" },
			})
		).json()) as { head: string };
		await db.prepare("UPDATE jobs SET pull=NULL WHERE id=?").bind(failed).run();
		await fail(failed);
		const id = await running({}, 5000);
		github.now = 6000;
		const response = await publish({ job: id, attempt: 1, head, pull: { title: "T", body: "B2" } });
		expect(await response.json()).toMatchObject({ pull: { number: 100 } });
		expect(github.pulls).toHaveLength(1);
		expect((await job(id)).pull).toBe(100);
	});

	it("starts a retried job fresh when its failed job published nothing", async () => {
		await fail(await running());
		const id = await running({}, 1000);
		expect(await job(id)).toMatchObject({ head: null, pull: null });
		const response = await publish({ job: id, attempt: 1, head: null, message: "m", changes: [file("a", "1")] });
		expect(response.status).toBe(200);
	});

	it("pauses a retried job when its branch moved outside kix after the failure", async () => {
		const failed = await running();
		const { head } = (await (
			await publish({ job: failed, attempt: 1, head: null, message: "one", changes: [file("a", "1")] })
		).json()) as { head: string };
		await fail(failed);
		github.refs.set("quest-bot-forks/project:quest/first", prHead);
		const id = await running({}, 1000);
		const response = await publish({
			job: id,
			attempt: 1,
			head,
			session: "s",
			message: "two",
			changes: [file("a", "2")],
		});
		expect(response.status).toBe(202);
		expect((await job(id)).questions[0]).toMatchObject({
			kind: "publication",
			prompt: { blocked: "The branch quest/first changed outside this job." },
		});
		expect(github.refs.get("quest-bot-forks/project:quest/first")).toBe(prHead);
	});

	it("keeps publishing a paused project's branch but opens no pull request", async () => {
		const id = await running();
		await db.prepare("UPDATE github_projects SET state='paused' WHERE id=10").run();
		const response = await publish({
			job: id,
			attempt: 1,
			head: null,
			message: "m",
			changes: [file("a", "1")],
			pull: { title: "T", body: "B" },
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Contributions are paused" });
		expect(github.refs.has("quest-bot-forks/project:quest/first")).toBe(true);
		expect(github.pulls).toEqual([]);
	});

	it("updates an iterated pull request's own head, and reports a contributor fork as blocked", async () => {
		const id = await running({
			workflow: "iterate",
			target: "pulls/2",
			revision: prHead,
			branch: "contributor/fix",
			trusted: false,
		});
		github.refs.set("upstream/project:contributor/fix", prHead);
		expect((await job(id)).head).toBe(prHead);
		const response = await publish({
			job: id,
			attempt: 1,
			head: prHead,
			message: "fix: review",
			changes: [file("a", "1")],
		});
		expect(response.status).toBe(200);
		const { head } = (await response.json()) as { head: string };
		expect(github.refs.get("upstream/project:contributor/fix")).toBe(head);
		expect(gitWrites().every((r) => r.token === "Bearer upstream-token")).toBe(true);
		expect(github.requests.filter((r) => r.path.endsWith("/access_tokens")).map((r) => r.body.permissions)).toEqual(
			[
				{ metadata: "read", pull_requests: "read" },
				{ metadata: "read", contents: "write" },
			],
		);
		expect((await publish({ job: id, attempt: 1, head, pull: { title: "T", body: "B" } })).status).toBe(409);

		github.head = { id: 99, name: "project", owner: { login: "contributor" } };
		const blocked = await publish({
			job: id,
			attempt: 1,
			head,
			session: "s",
			message: "m",
			changes: [file("a", "2")],
		});
		expect(blocked.status).toBe(202);
		expect((await job(id)).questions[0]!.prompt).toEqual({
			type: "publication",
			blocked: expect.stringContaining("contributor's fork"),
		});
	});

	it("refuses a service fork that does not fork the upstream", async () => {
		github.forkParent = 999;
		const id = await running();
		const response = await publish({ job: id, attempt: 1, head: null, message: "m", changes: [file("a", "1")] });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Provision the service fork quest-bot-forks/project of this upstream first",
		});
		expect(gitWrites()).toEqual([]);
	});

	it("validates the request before touching the job", async () => {
		const id = await running();
		for (const body of [
			{ job: id, attempt: 1, message: "m", changes: [file("a", "1")] },
			{ job: id, attempt: 1, head: null, changes: [file("a", "1")] },
			{ job: id, attempt: 1, head: null, message: "m", changes: [file("../a", "1")] },
			{ job: id, attempt: 1, head: null, message: "m", changes: [file("a", "1"), file("a", "2")] },
			{ job: id, attempt: 1, head: null, message: "m", changes: [{ path: "a", content: "not base64!" }] },
			{ job: id, attempt: 1, head: null, message: "m", changes: [{ ...file("a", "b", true), symlink: true }] },
			{ job: id, attempt: 1, head: null },
		])
			expect((await publish(body)).status).toBe(409);
		expect(github.requests).toEqual([]);
	});
});
