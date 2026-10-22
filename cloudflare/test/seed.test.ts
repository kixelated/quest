// The seeded local server's data must load on the current schema and routes,
// and show every inbox state it exists to check.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { fakeGitHub } from "../dev/github";
import { seed, world } from "../dev/seed";
import { app } from "../src/index";
import { inboxURL } from "../src/jobs/routes";
import { privateKey } from "./github-key";
import { origin } from "./login-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const db = env.DB;
afterEach(() => vi.restoreAllMocks());

it("seeds a representative inbox through the Worker's own routes", async () => {
	await db.batch([
		db.prepare("DELETE FROM jobs"),
		db.prepare("DELETE FROM runners"),
		db.prepare("DELETE FROM github_projects"),
		db.prepare("DELETE FROM github_installations"),
	]);
	const data = world();
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
