// The seeded local server's data must load on the current schema and routes,
// and show every inbox state it exists to check.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { commitOf, fakeGitHub, headOf, type World } from "../dev/github";
import { seed, world } from "../dev/seed";
import { app } from "../src/index";
import { inboxURL } from "../src/jobs/routes";
import { cancel } from "../src/jobs/store";
import { privateKey } from "./github-key";
import { origin } from "./login-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
afterEach(() => vi.restoreAllMocks());

/** Seed a fresh world against the fake GitHub, returning it, a request helper, and the session cookie. */
async function seeded() {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
	]);
	const data = { ...world(), forks: env.GITHUB_FORK_OWNER };
	vi.spyOn(globalThis, "fetch").mockImplementation(fakeGitHub(data));
	// Webhooks read and notify in the background, so each request finishes its `waitUntil` work.
	const request = async (path: string, init?: RequestInit) => {
		const ctx = createExecutionContext();
		const response = await app.request(`${origin}${path}`, init, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		return response;
	};
	const { cookie } = await seed({
		fetch: request,
		db,
		world: data,
		origin,
		secret: env.GITHUB_WEBHOOK_SECRET,
	});
	// The first project's inbox items and job forms, as the signed-in maintainer.
	const rocket = data.repos[0]!;
	const page = async (item: string) =>
		(await request(inboxURL(rocket.id, item), { headers: { Cookie: cookie } })).text();
	const post = (path: string, fields: Record<string, string>) =>
		request(`/projects/github/${rocket.owner}/${rocket.name}${path}`, {
			method: "POST",
			redirect: "manual",
			headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(fields).toString(),
		});
	return { data, request, cookie, rocket, page, post };
}

const latest = (target: string) =>
	db
		.prepare("SELECT id,state,head,pull,continues FROM jobs WHERE target=? ORDER BY createdAt DESC LIMIT 1")
		.bind(target)
		.first<{ id: string; state: string; head: string; pull: number | null; continues: string | null }>();

/** Start over on the seeded job whose branch changed, returning its open question. */
async function startOver(page: (item: string) => Promise<string>) {
	const blocked = await page("quest/m1/fonts.md");
	expect(blocked).toContain("Start over");
	return blocked.match(/name="question" value="([^"]+)"/)![1]!;
}

/** Run `before` once, ahead of the first request to GitHub matching `when`. */
function intercept(data: World, when: (url: URL, method: string) => boolean, before: () => Promise<Response | void>) {
	const github = fakeGitHub(data);
	let done = false;
	vi.mocked(globalThis.fetch).mockImplementation(async function (this: unknown, input, init) {
		const request = new Request(input, init);
		if (!done && when(new URL(request.url), request.method)) {
			done = true;
			const response = await before();
			if (response) return response;
		}
		return github.call(this, input, init);
	});
}

it("seeds a representative inbox through the Worker's own routes", async () => {
	const { data, request, cookie } = await seeded();
	const inbox = await request("/inbox", { headers: { Cookie: cookie } });
	expect(inbox.status).toBe(200);
	const html = await inbox.text();
	for (const text of [
		// The active decision: the oldest agent prompt, with its three questions.
		"What should an empty config file do?",
		"Which other config edge cases should the quest cover?",
		"Should the fix ship as a patch release?",
		// Up next and in progress.
		"Add passkey sign-in",
		"Try a shared build cache",
		"Fix the flaky sign-in redirect",
		"Build the landing page hero",
		"Bump dependencies",
		"Add a dark mode toggle",
		// Read by number after its webhook.
		"Sync stops after the laptop sleeps",
		"Export a project as a ZIP archive",
		"Settings page loses unsaved changes when the session expires",
		"Keep working offline",
		// A new plan named by its idea, and a finished job's follow-ups to plan.
		"Let people share a read-only link to a project",
		"Follow-ups from quest/m0/cli.md",
		// The paused project.
		"example/archive",
	])
		expect(html).toContain(text);
	// Claimed and blocked quests, and closed issues, are not offered.
	for (const text of ["Write the getting-started guide", "Report anonymous crash telemetry", "Old crash on startup"])
		expect(html).not.toContain(text);
	// A draft its starter holds is in progress; one handed back with decisions waits on the maintainer.
	const section = (heading: string) => html.match(new RegExp(`<h2>${heading}</h2>[\\s\\S]*?</ol>`))?.[0] ?? "";
	expect(section("In progress")).toMatch(/Draft the theme picker<\/a><span class="entry-meta"><span>Claimed draft/);
	expect(section("Up next")).toContain("Search quest titles");

	// The board agrees: a held draft claims its quest, a handed-back one is turned in.
	const board = await (
		await request("/projects/github/example/rocket/board", { headers: { Cookie: cookie } })
	).text();
	const row = (title: string) => board.match(new RegExp(`${title}</a>[\\s\\S]*?</li>`))?.[0] ?? "";
	expect(row("Support custom color themes")).toContain("Claimed");
	expect(row("Search across projects")).toContain("Ready to turn in");

	// The items this test checks open on their own. Each inbox page rechecks
	// GitHub authority, so the inbox tests cover the other threads.
	const open = async (target: string) => {
		const response = await request(inboxURL(9101, target), { headers: { Cookie: cookie } });
		expect(response.status).toBe(200);
		return response.text();
	};
	expect(await open("pulls/17")).toContain("Its starter holds this draft");
	// GitHub's UNKNOWN on a recorded pull request keeps the clean state it last reported.
	expect(await open("pulls/19")).toContain("/pulls/19/merge");

	// The clean pull request merges through the fake GitHub.
	const head = (await open("pulls/12")).match(
		/action="([^"]+\/pulls\/12\/merge)"[\s\S]*?name="head" value="([0-9a-f]{40})"/,
	);
	expect(head).not.toBeNull();
	const merged = await request(head![1]!, {
		method: "POST",
		redirect: "manual",
		headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ head: head![2]! }).toString(),
	});
	expect(merged.status).toBe(303);
	expect(data.repos[0]!.pulls.find((p) => p.number === 12)!.closed).toBe(true);
});

it("gets failed and blocked jobs moving again from the inbox", async () => {
	const { rocket, page, post } = await seeded();

	// The failed job opened pull request 20 without recording it; that claim does not block its retry.
	const failed = await page("quest/m0/import.md");
	expect(failed).not.toContain("no longer ready to start");
	const form = failed.match(
		/name="target" value="quest\/m0\/import.md"[\s\S]*?name="revision" value="([0-9a-f]{40})"/,
	);
	expect(form).not.toBeNull();
	const retried = await post("/jobs", {
		workflow: "start",
		target: "quest/m0/import.md",
		revision: form![1]!,
	});
	expect(retried.status).toBe(303);
	expect(await latest("quest/m0/import.md")).toMatchObject({
		state: "queued",
		head: headOf(
			rocket,
			rocket.pulls.find((p) => p.number === 20)!,
		),
		pull: null,
		continues: "seed-start-import",
	});

	// A branch changed outside its job starts over from the job's revision.
	const question = await startOver(page);
	const restarted = await post("/jobs/seed-start-fonts/answer", { question, restart: "1" });
	expect(restarted.status).toBe(303);
	expect(rocket.fork["quest/m1/fonts"]).toBe(commitOf(rocket));
	expect(await db.prepare("SELECT state FROM jobs WHERE id='seed-start-fonts'").first()).toEqual({
		state: "cancelled",
	});
	expect(await latest("quest/m1/fonts.md")).toMatchObject({
		state: "queued",
		head: commitOf(rocket),
		pull: null,
		continues: null,
	});
	// The decision is spent, so a repeated Start over is refused.
	const again = await post("/jobs/seed-start-fonts/answer", { question, restart: "1" });
	expect(again.status).not.toBe(303);

	// A finished job's follow-ups start their interview from the form the inbox shows.
	const followups = "plans/00000000-5eed-4000-8000-000000000002";
	const offer = (await page(followups)).match(
		/name="target" value="([^"]+)"[\s\S]*?name="revision" value="([0-9a-f]{40})"[\s\S]*?Plan these follow-ups/,
	);
	expect(offer?.[1]).toBe(followups);
	const planned = await post("/jobs", { workflow: "plan", target: followups, revision: offer![2]! });
	expect(planned.status).toBe(303);
	expect(await latest(followups)).toMatchObject({ state: "queued" });
});

it("never resets the branch for a Start over that a concurrent cancel beat", async () => {
	const { data, rocket, page, post } = await seeded();
	const question = await startOver(page);
	// Another maintainer cancels the job after this request read it, while it rechecks GitHub.
	intercept(
		data,
		(url) => url.pathname === `/repos/${data.forks}/${rocket.name}`,
		() => cancel(db, "seed-start-fonts", "another-maintainer", Date.now()),
	);
	const restarted = await post("/jobs/seed-start-fonts/answer", { question, restart: "1" });
	expect(restarted.status).toBe(409);
	expect(rocket.fork["quest/m1/fonts"]).toBe("f".repeat(40));
	expect(await latest("quest/m1/fonts.md")).toMatchObject({ id: "seed-start-fonts", state: "cancelled" });
});

it("leaves a Start over whose reset failed waiting to start over again", async () => {
	const { data, rocket, page, post } = await seeded();
	const question = await startOver(page);
	intercept(
		data,
		(url, method) => method === "PATCH" && url.pathname.startsWith(`/repos/${data.forks}/${rocket.name}/git/refs/`),
		async () => Response.json({ message: "Server Error" }, { status: 502 }),
	);
	const restarted = await post("/jobs/seed-start-fonts/answer", { question, restart: "1" });
	expect(restarted.status).not.toBe(303);
	expect(rocket.fork["quest/m1/fonts"]).toBe("f".repeat(40));
	// The claim stands: the old job ended, and its replacement waits on the same decision instead of running.
	expect(await db.prepare("SELECT state FROM jobs WHERE id='seed-start-fonts'").first()).toEqual({
		state: "cancelled",
	});
	const held = await latest("quest/m1/fonts.md");
	expect(held).toMatchObject({ state: "waiting", head: commitOf(rocket), continues: null });

	// Starting the replacement over resets the branch once GitHub accepts it.
	vi.mocked(globalThis.fetch).mockImplementation(fakeGitHub(data));
	const retry = await startOver(page);
	expect(retry).not.toBe(question);
	const again = await post(`/jobs/${held!.id}/answer`, { question: retry, restart: "1" });
	expect(again.status).toBe(303);
	expect(rocket.fork["quest/m1/fonts"]).toBe(commitOf(rocket));
	expect(await latest("quest/m1/fonts.md")).toMatchObject({ state: "queued", head: commitOf(rocket) });
});
