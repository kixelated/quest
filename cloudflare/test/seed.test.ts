// The seeded local server's data must load on the current schema and routes,
// and show every inbox state it exists to check.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { fakeGitHub } from "../dev/github";
import { seed, world } from "../dev/seed";
import { app } from "../src/index";
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
	// Background work, such as a webhook's notification, finishes before the next step.
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
		"Issue #9",
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

	// Every seeded decision opens on its own.
	const items = [...html.matchAll(/href="(\/inbox\?project=[^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
	expect(items.length).toBeGreaterThan(5);
	for (const href of new Set(items)) expect((await request(href, { headers: { Cookie: cookie } })).status).toBe(200);

	// The clean pull request merges through the fake GitHub.
	const pull = await request("/inbox?project=9101&item=pulls/12", { headers: { Cookie: cookie } });
	const head = (await pull.text()).match(
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
