// The seeded local server's data must load on the current schema and routes,
// and show every inbox state it exists to check.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { commitOf, fakeGitHub, headOf } from "../dev/github";
import { seed, world } from "../dev/seed";
import { app } from "../src/index";
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
	return { data, request, cookie };
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

it("gets failed and blocked jobs moving again from the inbox", async () => {
	const { data, request, cookie } = await seeded();
	const rocket = data.repos[0]!;
	const page = async (item: string) =>
		(
			await request(`/inbox?project=${rocket.id}&item=${encodeURIComponent(item)}`, {
				headers: { Cookie: cookie },
			})
		).text();
	const post = (path: string, fields: Record<string, string>) =>
		request(path, {
			method: "POST",
			redirect: "manual",
			headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(fields).toString(),
		});
	const project = `/projects/github/${rocket.owner}/${rocket.name}`;
	const latest = (target: string) =>
		db
			.prepare("SELECT state,head,pull,continues FROM jobs WHERE target=? ORDER BY createdAt DESC LIMIT 1")
			.bind(target)
			.first();

	// The failed job opened pull request 17 without recording it; that claim does not block its retry.
	const failed = await page("quest/m0/import.md");
	expect(failed).not.toContain("no longer ready to start");
	const form = failed.match(
		/name="target" value="quest\/m0\/import.md"[\s\S]*?name="revision" value="([0-9a-f]{40})"/,
	);
	expect(form).not.toBeNull();
	const retried = await post(`${project}/jobs`, {
		workflow: "start",
		target: "quest/m0/import.md",
		revision: form![1]!,
	});
	expect(retried.status).toBe(303);
	expect(await latest("quest/m0/import.md")).toEqual({
		state: "queued",
		head: headOf(
			rocket,
			rocket.pulls.find((p) => p.number === 17)!,
		),
		pull: null,
		continues: "seed-start-import",
	});

	// A branch changed outside its job starts over from the job's revision.
	const blocked = await page("quest/m1/themes.md");
	expect(blocked).toContain("Start over");
	const question = blocked.match(/name="question" value="([^"]+)"/)![1]!;
	const restarted = await post(`${project}/jobs/seed-start-themes/answer`, { question, restart: "1" });
	expect(restarted.status).toBe(303);
	expect(rocket.fork["quest/m1/themes"]).toBe(commitOf(rocket));
	expect(await db.prepare("SELECT state FROM jobs WHERE id='seed-start-themes'").first()).toEqual({
		state: "cancelled",
	});
	expect(await latest("quest/m1/themes.md")).toEqual({
		state: "queued",
		head: commitOf(rocket),
		pull: null,
		continues: null,
	});
	// The decision is spent, so a repeated Start over is refused.
	const again = await post(`${project}/jobs/seed-start-themes/answer`, { question, restart: "1" });
	expect(again.status).not.toBe(303);
});
