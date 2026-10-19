import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import * as store from "../src/jobs/store";
import { privateKey } from "./github-key";
import { origin } from "./login-fixtures";
import { commit, delivery, head, maintainerOf, project } from "./project-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
const jobs = "/projects/github/upstream/project/jobs";

let user = "";
let cookie = "";
let github: Awaited<ReturnType<typeof maintainerOf>>["github"];

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
	]);
	({ user, cookie, github } = await maintainerOf());
});
afterEach(() => vi.restoreAllMocks());

async function inbox(query: Record<string, string> = {}) {
	const response = await app.request(
		`${origin}/inbox?${new URLSearchParams(query)}`,
		{ headers: { Cookie: cookie } },
		testEnv,
	);
	expect(response.status).toBe(200);
	return response.text();
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
		const answered = await submit(`${jobs}/${id}/answer`, [
			["question", question],
			["text", "Drop the source change"],
		]);
		expect(answered.status).toBe(303);
		const job = (await store.readJob(db, id))!;
		expect(job.state).toBe("queued");
		expect(job.questions[0]!.answer).toBe("Drop the source change");
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

	it("keeps older questions and failures beyond the newest fifty jobs", async () => {
		const { id, runner } = await running();
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
		expect(thread(await inbox())).toContain("Still there?");
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

	it("reports a project without current authority and hides its items", async () => {
		github.role = "write";
		const html = await inbox();
		expect(html).toContain("Unavailable: Current GitHub maintainer authority required");
		expect(html).not.toContain("Idea");
		expect(html).toContain("Nothing needs a decision right now.");
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
