import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { questHref } from "../src/inbox/model";
import * as store from "../src/jobs/store";
import { privateKey } from "./github-key";
import { identity, oauth, origin } from "./login-fixtures";
import { commit, delivery, head, maintainerOf, project } from "./project-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
const jobs = "/projects/github/upstream/project/jobs";

let user = "";
let cookie = "";
let github: Awaited<ReturnType<typeof maintainerOf>>["github"];
let mock: Awaited<ReturnType<typeof maintainerOf>>["mock"];

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
	]);
	({ user, cookie, github, mock } = await maintainerOf());
});
afterEach(() => vi.restoreAllMocks());

async function inbox(query: Record<string, string> = {}, session = cookie) {
	const response = await app.request(
		`${origin}/inbox?${new URLSearchParams(query)}`,
		{ headers: { Cookie: session } },
		testEnv,
	);
	expect(response.status).toBe(200);
	return response.text();
}
/** Sign in another GitHub user, who holds the maintain role when `maintains`. */
async function other(maintains: boolean) {
	const who = identity("github");
	const session = (await oauth(who)).session!;
	vi.spyOn(globalThis, "fetch").mockImplementation(mock);
	if (maintains) github.maintainers.push(who.id);
	const { userId } = (await db
		.prepare("SELECT userId FROM account WHERE providerId='github' AND accountId=?")
		.bind(who.id)
		.first<{ userId: string }>())!;
	return { session, id: userId };
}
/** Open the project's activity page, which checks maintainer authority. */
function visit(session = cookie) {
	return app.request(`${origin}/projects/github/upstream/project/state`, { headers: { Cookie: session } }, testEnv);
}
async function members() {
	const { results } = await db
		.prepare("SELECT user FROM github_project_members WHERE repository=10")
		.all<{ user: string }>();
	return results.map((row) => row.user);
}
/** How many items the user has read or skipped on the project. */
async function reads(who = user) {
	const row = await db
		.prepare("SELECT count(*) AS n FROM inbox_items WHERE repository=10 AND user=?")
		.bind(who)
		.first<{ n: number }>();
	return row!.n;
}
/** The active decision thread's markup. */
function thread(html: string) {
	return html.match(/<article class="ql-panel decision"[\s\S]*?<\/article>/)?.[0] ?? "";
}
function submit(path: string, fields: [string, string][]) {
	return app.request(
		`${origin}${path}`,
		{ method: "POST", headers: { Cookie: cookie, Origin: origin }, body: new URLSearchParams(fields) },
		testEnv,
	);
}
async function running(workflow: store.Workflow = "start", target = "quest/first.md") {
	const machine = await store.createRunner(db, user, "laptop", "linux", false, 0);
	const runner = { ...machine, owner: user, name: "laptop", platform: "linux" as const, vm: 0 };
	await store.report(
		db,
		runner,
		[
			{ id: "main", provider: "anthropic", kind: "subscription", label: "Main plan", limited: false },
			{ id: "spare", provider: "anthropic", kind: "subscription", label: "Spare plan", limited: false },
		],
		[],
		0,
	);
	const branch = target.replace(/\.md$/, "");
	const { id } = await store.createJob(
		db,
		{ repository: 10, actor: user, workflow, target, revision: commit, branch, trusted: true },
		1,
	);
	await store.dispatch(db, user, new Map([[runner.id, 1]]), 2);
	return { id, runner };
}

describe("decision inbox", () => {
	it("sends visitors to sign in, and maintainers there after signing in", async () => {
		const visitor = await app.request(`${origin}/inbox`, {}, testEnv);
		expect(visitor.status).toBe(303);
		expect(visitor.headers.get("Location")).toBe("/sign-in?next=/inbox");
		const signIn = await (await app.request(`${origin}/sign-in`, {}, testEnv)).text();
		expect(signIn).toContain('name="next" value="/inbox"');
	});

	it("presents each new pull request, issue, and ready quest as one decision", async () => {
		const html = await inbox();
		// The pull request is the active decision, bound to the head on screen.
		const active = thread(html);
		expect(active).toContain("Fix");
		expect(active).toContain("Checks: success");
		expect(active).toContain(`name="revision" value="${head}"`);
		expect(active).toContain("Iterate on this PR");
		expect(active).toContain("Review on GitHub");
		expect(html.match(/<h2>Up next<\/h2>[\s\S]*?<\/ol>/)![0]).toMatch(/Idea[\s\S]*New[\s\S]*First[\s\S]*New/);
		expect(await db.prepare("SELECT item,seen FROM inbox_items WHERE user=?").bind(user).all()).toMatchObject({
			results: [{ item: "pulls/2", seen: "0" }],
		});
		const issue = thread(await inbox({ project: "10", item: "issues/1" }));
		expect(issue).toContain("By reporter");
		expect(issue).toContain("Plan this issue");
		expect(thread(await inbox({ project: "10", item: "quest/first.md" }))).toContain("Start this quest");
		expect(await inbox({ project: "10", item: "issues/99" })).toContain("no longer open");
	});

	it("coalesces webhook updates into the same item and marks it unread again", async () => {
		await inbox();
		const event = {
			action: "synchronize",
			installation: { id: 5 },
			repository: { id: 10 },
			pull_request: { id: 21, number: 2 },
		};
		const id = crypto.randomUUID();
		expect((await delivery("pull_request", event, id)).status).toBe(202);
		expect(await (await delivery("pull_request", event, id)).json()).toEqual({ status: "duplicate" });
		expect((await delivery("pull_request", event)).status).toBe(202);
		const opened = { ...event, action: "opened", issue: { id: 13, number: 3 }, pull_request: undefined };
		expect((await delivery("issues", opened)).status).toBe(202);
		const html = await inbox({ project: "10", item: "issues/1" });
		expect(html.match(/>Fix</g)).toHaveLength(1);
		expect(html).toMatch(/Fix<\/a><span class="entry-meta"><span class="tag">New/);
		// A webhook only points at the new issue; refreshing reads it, and no work starts before.
		expect(html).toContain("Issue #3");
		expect(thread(html)).toContain("GitHub reported changes");
		expect(thread(html)).not.toContain("Plan this issue");
	});

	it("starts work bound to the revision on screen and shows its progress plainly", async () => {
		const stale = await submit(jobs, [
			["workflow", "iterate"],
			["target", "pulls/2"],
			["revision", "b".repeat(40)],
		]);
		expect(stale.status).toBe(409);
		expect(await stale.text()).toContain("This changed on GitHub since you looked");
		const started = await submit(jobs, [
			["workflow", "iterate"],
			["target", "pulls/2"],
			["revision", head],
		]);
		expect(started.status).toBe(303);
		expect(started.headers.get("Location")).toBe("/inbox?project=10&item=pulls%2F2");
		const html = await inbox({ project: "10", item: "pulls/2" });
		expect(html.match(/<h2>In progress<\/h2>[\s\S]*?<\/ol>/)![0]).toContain("Fix");
		expect(thread(html)).toContain("none of your runners are online");
		expect(thread(html)).toContain("Stop this job");
		const [job] = await store.listJobs(db, 10);
		const stopped = await submit(`${jobs}/${job!.id}/cancel`, []);
		expect(stopped.status).toBe(303);
		expect((await store.readJob(db, job!.id))!.state).toBe("cancelled");
		// A stopped job sets its item aside until the pull request changes.
		expect(await inbox()).toMatch(/Skipped and finished \(1\)[\s\S]*Fix/);
	});

	it("merges a clean pull request at the head on screen, or says why GitHub refused", async () => {
		const merge = "/projects/github/upstream/project/pulls/2/merge";
		const active = thread(await inbox());
		expect(active).toContain(`action="${merge}"`);
		expect(active).toContain(`name="head" value="${head}"`);
		expect(active).toContain('<button class="button quiet">Iterate on this PR');
		const moved = await submit(merge, [["head", "b".repeat(40)]]);
		expect(moved.status).toBe(403);
		expect(await moved.text()).toContain("head moved since you looked; review it again");
		github.refuse = "At least 1 approving review is required by reviewers with write access.";
		const refused = await submit(merge, [["head", head]]);
		expect(refused.status).toBe(403);
		expect(await refused.text()).toContain(
			"GitHub refused the merge: At least 1 approving review is required by reviewers with write access.",
		);
		// Each click is one request bound to its head; a refusal is never retried.
		expect(github.merged).toHaveLength(2);
		github.refuse = null;
		github.methods = ["squash"];
		const merged = await submit(merge, [
			["head", head],
			["version", "0"],
		]);
		expect(merged.status).toBe(303);
		expect(merged.headers.get("Location")).toBe("/inbox");
		expect(github.merged.at(-1)).toEqual({ sha: head, merge_method: "squash" });
		// The merged item is finished, and no new work starts before GitHub is read again.
		const html = await inbox();
		expect(html).toMatch(/Skipped and finished \(1\)[\s\S]*Fix/);
		expect(thread(html)).toContain("GitHub reported changes");
	});

	it("offers merge only on a clean pull request no job holds, to current maintainers", async () => {
		const merge = "/projects/github/upstream/project/pulls/2/merge";
		await db
			.prepare(
				"UPDATE github_project_activity SET data=json_set(data,'$.mergeStateStatus','BLOCKED') WHERE id='21'",
			)
			.run();
		let active = thread(await inbox());
		expect(active).not.toContain(merge);
		expect(active).toContain("Review on GitHub");
		expect(active).toContain('<button class="button primary">Iterate on this PR');
		await db
			.prepare(
				"UPDATE github_project_activity SET data=json_set(data,'$.mergeStateStatus','CLEAN') WHERE id='21'",
			)
			.run();
		await running("iterate", "pulls/2");
		active = thread(await inbox({ project: "10", item: "pulls/2" }));
		expect(active).not.toContain(merge);
		const held = await submit(merge, [["head", head]]);
		expect(held.status).toBe(409);
		expect(await held.text()).toContain("job before merging it");
		await db.prepare("DELETE FROM jobs").run();
		github.role = "write";
		const outsider = await submit(merge, [["head", head]]);
		expect(outsider.status).toBe(403);
		expect(await outsider.text()).toContain("Current GitHub maintainer authority required");
		expect(github.merged).toHaveLength(0);
	});

	it("offers a bootstrap job when the default branch has no flake", async () => {
		github.flake = false;
		const refused = await submit(jobs, [
			["workflow", "start"],
			["target", "quest/first.md"],
			["revision", commit],
		]);
		expect(refused.status).toBe(409);
		const html = await refused.text();
		expect(html).toContain("start a bootstrap job");
		expect(html).toContain('name="workflow" value="bootstrap"');
		expect((await submit(jobs, [["workflow", "bootstrap"]])).status).toBe(303);
	});

	it("renders an agent's questions, records the answers once, and keeps them in the thread", async () => {
		const { id, runner } = await running();
		const prompt = {
			questions: [
				{
					header: "Scope",
					question: "Ship <b>now</b>?",
					options: [{ label: "Yes", description: "Smallest change", recommended: true }, { label: "No" }],
				},
				{ question: "Which parts?", options: [{ label: "API" }, { label: "UI" }], multiple: true },
			],
		};
		const { question } = await store.ask(
			db,
			runner,
			id,
			1,
			{ summary: "Planned the change.", session: "s", prompt },
			3,
		);
		const active = thread(await inbox());
		expect(active).toContain("Waiting for your decision");
		expect(active).toContain("Planned the change.");
		// Agent text is escaped, and the recommendation is marked but never chosen for the maintainer.
		expect(active).toContain("Ship &lt;b&gt;now&lt;/b&gt;?");
		expect(active).toContain('<span class="tag">Recommended</span>');
		expect(active).not.toContain("checked");
		expect(active).toContain('type="checkbox" name="q1" value="UI"');
		const answer: [string, string][] = [
			["question", question],
			["q0-text", "Only after the release"],
			["q1", "API"],
			["q1", "UI"],
		];
		expect(
			(
				await submit(`${jobs}/${id}/answer`, [
					["question", question],
					["q1", "Z"],
				])
			).status,
		).toBe(409);
		const answered = await submit(`${jobs}/${id}/answer`, answer);
		expect(answered.status).toBe(303);
		const job = (await store.readJob(db, id))!;
		expect(job.state).toBe("queued");
		expect(job.questions[0]!.answer).toEqual({
			answers: [{ choices: [], text: "Only after the release" }, { choices: ["API", "UI"] }],
		});
		const again = await submit(`${jobs}/${id}/answer`, answer);
		expect(again.status).toBe(409);
		expect(await again.text()).toContain("Question is no longer open");
		const after = thread(await inbox({ project: "10", item: "quest/first.md" }));
		expect(after).toContain("Earlier answers (1)");
		expect(after).toContain("API · UI");
	});

	it("asks which account continues a limited job instead of switching", async () => {
		const { id, runner } = await running();
		await store.finish(db, runner, id, 1, { outcome: "limited", summary: "Hit the plan limit.", result: null }, 3);
		const active = thread(await inbox());
		expect(active).toContain("Account limited");
		expect(active).toContain(`value="${runner.id}:spare"`);
		expect(active).toContain("limited; choosing it again retries");
		const [question] = (await store.readJob(db, id))!.questions;
		expect(
			(
				await submit(`${jobs}/${id}/answer`, [
					["question", question!.id],
					["account", `${runner.id}:spare`],
				])
			).status,
		).toBe(303);
		expect(await store.readJob(db, id)).toMatchObject({ state: "queued", pinAccount: "spare" });
	});

	it("asks how to continue when publishing needs a decision", async () => {
		const { id, runner } = await running();
		const prompt = {
			type: "publication",
			refused: [{ path: "<src>/index.ts", reason: "Planning publishes only quest files" }],
		};
		const { question } = await store.ask(
			db,
			runner,
			id,
			1,
			{ kind: "publication", summary: "Publishing needs a decision", session: "s", prompt },
			3,
		);
		const active = thread(await inbox());
		expect(active).toContain("Publishing needs your decision");
		// Runner-supplied paths are escaped.
		expect(active).toContain("<code>&lt;src&gt;/index.ts</code>: Planning publishes only quest files");
		// The form's limit counts characters, not their JSON escapes, and a line break as one.
		const text = `Drop the source change. ${'"\\\n'.repeat(325)}x`;
		expect(text).toHaveLength(1000);
		// Browsers submit a textarea's line breaks as CRLF.
		const sent = (reply: string) =>
			submit(`${jobs}/${id}/answer`, [
				["question", question],
				["text", reply.replaceAll("\n", "\r\n")],
			]);
		const long = await sent(`${text}y`);
		expect(long.status).toBe(409);
		expect(await long.text()).toContain("Reply in at most 1000 characters");
		expect((await sent(text)).status).toBe(303);
		const job = (await store.readJob(db, id))!;
		expect(job.state).toBe("queued");
		expect(job.questions[0]!.answer).toBe(text);
		expect(thread(await inbox({ project: "10", item: "quest/first.md" }))).toContain("Drop the source change");
	});

	it("offers a refresh for a failed job whose pull request is no longer observed", async () => {
		const { id, runner } = await running("iterate", "pulls/2");
		await store.finish(db, runner, id, 1, { outcome: "failed", summary: "Broke.", result: null }, 3);
		await db.prepare("DELETE FROM github_project_activity WHERE kind='pull'").run();
		const active = thread(await inbox({ project: "10", item: "pulls/2" }));
		expect(active).toContain("Failed");
		expect(active).toContain("Refresh to read this from GitHub.");
		expect(active).not.toContain("Try again");
	});

	it("keeps each target's latest job however many newer jobs there are", async () => {
		const { id, runner } = await running();
		await store.createJob(
			db,
			{
				repository: 10,
				actor: user,
				workflow: "iterate",
				target: "pulls/2",
				revision: head,
				branch: "contributor/fix",
				trusted: false,
			},
			2,
		);
		const failed = await store.createJob(
			db,
			{
				repository: 10,
				actor: user,
				workflow: "plan",
				target: "issues/1",
				revision: commit,
				branch: "plan/issue-1",
				trusted: true,
			},
			2,
		);
		await store.ask(
			db,
			runner,
			id,
			1,
			{
				summary: "Asked early.",
				session: "s",
				prompt: { questions: [{ question: "Still there?", options: [] }] },
			},
			3,
		);
		for (let i = 0; i < 50; i++)
			await store.createJob(
				db,
				{
					repository: 10,
					actor: user,
					workflow: "start",
					target: `quest/later-${i}.md`,
					revision: commit,
					branch: `quest/later-${i}`,
					trusted: true,
				},
				10 + i,
			);
		await db.batch([
			db.prepare("UPDATE jobs SET state='completed' WHERE id NOT IN (?,?)").bind(id, failed.id),
			db.prepare("UPDATE jobs SET state='failed' WHERE id=?").bind(failed.id),
		]);
		const html = await inbox();
		expect(thread(html)).toContain("Still there?");
		// The pull request's finished job still sets it aside rather than offering it as new work.
		expect(html).toMatch(/Skipped and finished \(1\)[\s\S]*Fix/);
		// The failure stays a failure, not fresh work on the issue.
		const issue = thread(await inbox({ project: "10", item: "issues/1" }));
		expect(issue).toContain("Failed");
		expect(issue).toContain("Try again");
	});

	it("retries a failed planning interview on its own target", async () => {
		const target = `plans/${crypto.randomUUID()}`;
		const { id, runner } = await running("plan", target);
		await store.finish(db, runner, id, 1, { outcome: "failed", summary: "Broke.", result: null }, 3);
		const active = thread(await inbox({ project: "10", item: target }));
		expect(active).toContain(`name="target" value="${target}"`);
		const retried = await submit(jobs, [
			["workflow", "plan"],
			["target", target],
			["revision", commit],
		]);
		expect(retried.status).toBe(303);
		const [latest] = await store.listJobs(db, 10);
		expect(latest).toMatchObject({ target, state: "queued" });
		expect(latest!.id).not.toBe(id);
	});

	it("offers no retry for a failed quest that is no longer ready", async () => {
		const { id, runner } = await running("start", "quest/gone.md");
		await store.finish(db, runner, id, 1, { outcome: "failed", summary: "Broke.", result: null }, 3);
		const active = thread(await inbox({ project: "10", item: "quest/gone.md" }));
		expect(active).toContain("This quest is no longer ready to start");
		expect(active).not.toContain("Try again");
	});

	it("encodes quest paths in board links", () => {
		const enrolled = { owner: "upstream", name: "project" } as Parameters<typeof questHref>[0];
		expect(questHref(enrolled, "quest/a#b?.md")).toBe("/projects/github/upstream/project/board/quest/a%23b%3F");
		expect(questHref(enrolled, "quest/epic/README.md")).toBe("/projects/github/upstream/project/board/quest/epic");
	});

	it("skips an item until it changes", async () => {
		const skipped = await submit("/projects/github/upstream/project/skip", [
			["item", "issues/1"],
			["version", "0"],
		]);
		expect(skipped.status).toBe(303);
		let html = await inbox();
		expect(html.match(/<h2>Up next<\/h2>[\s\S]*?<\/ol>/)![0]).not.toContain("Idea");
		expect(html).toMatch(/Skipped and finished \(1\)[\s\S]*Idea/);
		await db.prepare("UPDATE github_project_activity SET changedAt=5 WHERE kind='issue' AND id='11'").run();
		html = await inbox();
		expect(html).not.toContain("Skipped and finished");
	});

	it("shows a co-maintainer the project once they open it", async () => {
		const co = await other(true);
		let html = await inbox({}, co.session);
		expect(html).toContain("No enrolled projects yet");
		expect(html).not.toContain("Idea");
		expect((await visit(co.session)).status).toBe(200);
		expect(await members()).toEqual(expect.arrayContaining([user, co.id]));
		html = await inbox({}, co.session);
		expect(html).toContain("Idea");
		expect(html).not.toContain("Unavailable");
	});

	it("never lists a project for a non-maintainer", async () => {
		const outsider = await other(false);
		const refused = await visit(outsider.session);
		expect(refused.status).toBe(403);
		expect(await refused.text()).toContain("Current GitHub maintainer authority required");
		expect(await members()).toEqual([user]);
		const html = await inbox({}, outsider.session);
		expect(html).toContain("No enrolled projects yet");
		expect(html).not.toContain("Idea");
	});

	it("drops a revoked maintainer along with their read state", async () => {
		await submit("/projects/github/upstream/project/skip", [
			["item", "issues/1"],
			["version", "0"],
		]);
		expect(await reads()).toBe(1);
		github.role = "write";
		let html = await inbox();
		expect(html).not.toContain("Idea");
		expect(html).not.toContain("Unavailable");
		expect(html).toContain("No enrolled projects yet");
		expect(await members()).toEqual([]);
		expect(await reads()).toBe(0);
		// Regaining the role does not restore membership until the maintainer opens the project.
		github.role = "maintain";
		expect(await inbox()).not.toContain("Idea");
		expect((await visit()).status).toBe(200);
		html = await inbox();
		expect(html.match(/<h2>Up next<\/h2>[\s\S]*?<\/ol>/)![0]).toContain("Idea");
		expect(html).not.toContain("Skipped and finished");
	});

	it("keeps membership when a maintainer check cannot complete", async () => {
		await submit("/projects/github/upstream/project/skip", [
			["item", "issues/1"],
			["version", "0"],
		]);
		github.limited = true;
		let html = await inbox();
		expect(html).toContain("Unavailable: GitHub request failed (429)");
		expect(html).not.toContain("Idea");
		expect((await visit()).status).toBe(403);
		expect(await members()).toEqual([user]);
		expect(await reads()).toBe(1);
		github.limited = false;
		html = await inbox();
		expect(html).toMatch(/Skipped and finished \(1\)[\s\S]*Idea/);
	});

	it("keeps paused projects' questions but offers no new work", async () => {
		const { id, runner } = await running();
		await project(10, user, "paused");
		await store.ask(
			db,
			runner,
			id,
			1,
			{ summary: "Paused?", session: "s", prompt: { questions: [{ question: "Go on?", options: [] }] } },
			3,
		);
		const html = await inbox();
		expect(thread(html)).toContain("Go on?");
		expect(html).toContain("Contributions paused");
		expect(html).not.toContain("Idea");
		expect(html).not.toContain("Start a planning interview");
	});
});
