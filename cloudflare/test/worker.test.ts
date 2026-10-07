import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const origin = "http://localhost:8787";

describe("Worker", () => {
	it("serves health and handles unknown routes", async () => {
		expect(await (await SELF.fetch(`${origin}/health`)).json()).toEqual({ status: "ok" });
		const missing = await SELF.fetch(`${origin}/missing`);
		expect(missing.status).toBe(404);
		expect(await missing.text()).toContain("Uncharted territory");
	});
	it("renders the home page in the shared layout", async () => {
		const html = await (await SELF.fetch(origin)).text();
		expect(html).toContain("A quest log for your repo and your agents");
		expect(html).toContain(`Follow ${origin}/setup to set up Quest here.`);
		expect(html).toContain('href="/theme/theme.css"');
		expect(html).toContain(`content="${origin}/theme/og.png"`);
		for (const section of ["files", "git", "sample", "how", "map", "party"]) {
			expect(html).toContain(`id="${section}"`);
		}
	});
	it("maps the repository's own quest tree on the home page", async () => {
		const html = await (await SELF.fetch(origin)).text();
		// Acts open their section of the board; waypoints open the quest files.
		expect(html).toContain('href="/repos/quest#a0"');
		expect(html).toMatch(
			/class="waypoint ql-(xs|s|m|l|xl) waypoint-[a-z-]+"><a href="https:\/\/github\.com\/kixelated\/quest\/blob\/main\/quest\/a0\//,
		);
	});
	it("renders the repository's docs", async () => {
		const index = await (await SELF.fetch(`${origin}/docs`)).text();
		expect(index).toContain('href="/docs/getting-started"');
		expect(index).toContain("Use Quest in your repository");

		const page = await SELF.fetch(`${origin}/docs/getting-started`);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain("<title>Use Quest in your repository · Quest</title>");
		expect(html).toContain('<h2 id="set-it-up">');
		// Relative links that work on GitHub point at GitHub from the site.
		expect(html).toContain('href="https://github.com/kixelated/quest/blob/main/SETUP.md"');
		expect((await SELF.fetch(`${origin}/docs/missing`)).status).toBe(404);
	});
	it("renders this repository's quest board", async () => {
		const response = await SELF.fetch(`${origin}/repos/quest`);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("<h1>Quest log</h1>");
		expect(html).toContain("kixelated/quest");
		expect(html).toMatch(/Act \d/);
		expect(html).toContain('role="progressbar"');
		expect(html).toContain('href="/repos/quest?show=available"');
		const filtered = await (await SELF.fetch(`${origin}/repos/quest?show=available`)).text();
		expect(filtered).not.toContain("Requires: ");
		expect((await SELF.fetch(`${origin}/repos/missing`)).status).toBe(404);
	});
	it("renders a quest page with breadcrumbs and its next step", async () => {
		const board = await (await SELF.fetch(`${origin}/repos/quest`)).text();
		const href = /<a class="entry-title" href="(\/repos\/quest\/quest\/[^"]+)"/.exec(board)![1];
		const page = await SELF.fetch(`${origin}${href}`);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain('aria-label="Breadcrumb"');
		expect(html).toContain("<h2>Objectives</h2>");
		expect((await SELF.fetch(`${origin}/repos/quest/quest/missing`)).status).toBe(404);
		const root = await SELF.fetch(`${origin}/repos/quest/quest/README`, { redirect: "manual" });
		expect(root.headers.get("location")).toBe("/repos/quest");
	});
	it("returns to a local page after signing in, and only a local page", async () => {
		// Better Auth stores each sign-in's callback with its OAuth state.
		const callback = async (next: string) => {
			await env.DB.prepare("DELETE FROM verification").run();
			const response = await SELF.fetch(`${origin}/sign-in`, {
				method: "POST",
				headers: { Origin: origin },
				body: new URLSearchParams({ next }),
				redirect: "manual",
			});
			expect(response.status).toBe(303);
			const row = await env.DB.prepare("SELECT value FROM verification").first<{ value: string }>();
			return JSON.parse(row!.value).callbackURL;
		};
		expect(await callback("/repos/quest/quest/a0")).toBe("/repos/quest/quest/a0");
		expect(await callback("/repos/quest?show=available")).toBe("/repos/quest?show=available");
		const unsafe = ["//evil.example", "/\\evil.example", "https://evil.example", "/\t/evil.example", "/\n/x"];
		for (const next of [...unsafe, "/%2F/evil.example", "/%5cevil.example"]) {
			expect(await callback(next)).toBe("/");
		}
	});
	it("offers to return to the page as requested, still encoded", async () => {
		const response = await SELF.fetch(`${origin}/%09/evil.example`);
		expect(response.status).toBe(404);
		expect(await response.text()).toContain('name="next" value="/%09/evil.example"');
		for (const path of ["%E0", "%", "a0%2Fcloudflare%2Fboard"]) {
			expect((await SELF.fetch(`${origin}/repos/quest/quest/${path}`)).status).toBe(404);
		}
	});
	it("redirects the setup short link to SETUP.md", async () => {
		const response = await SELF.fetch(`${origin}/setup`, { redirect: "manual" });
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://github.com/kixelated/quest/blob/main/SETUP.md");
	});
	it("renders a GitHub sign-in form without a session", async () => {
		const response = await SELF.fetch(origin);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		// The sign-in form's post must carry this origin, not `null`.
		expect(response.headers.get("referrer-policy")).toBe("same-origin");
		expect(await response.text()).toContain("Sign in with GitHub");
	});
	it("starts GitHub OAuth with persisted state and cookies", async () => {
		const response = await SELF.fetch(`${origin}/sign-in`, {
			method: "POST",
			headers: { Origin: origin },
			redirect: "manual",
		});
		expect(response.status).toBe(303);
		const location = new URL(response.headers.get("location")!);
		expect(location.origin).toBe("https://github.com");
		expect(location.searchParams.get("client_id")).toBe("test-client-id");
		expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/github`);
		expect(location.searchParams.get("state")).toBeTruthy();
		expect(response.headers.get("set-cookie")).toContain("better-auth.state=");
	});
	it("completes GitHub OAuth, persists the D1 session, and signs out", async () => {
		const start = await SELF.fetch(`${origin}/sign-in`, {
			method: "POST",
			headers: { Origin: origin },
			redirect: "manual",
		});
		const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
		const stateCookie = start.headers.get("set-cookie")!.split(";")[0];
		const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === "https://github.com/login/oauth/access_token") {
				return Response.json({
					access_token: "mock-token",
					token_type: "bearer",
					scope: "read:user,user:email",
				});
			}
			if (url === "https://api.github.com/user") {
				return Response.json({
					id: 1234,
					login: "contributor",
					name: "Contributor",
					email: "contributor@example.com",
					avatar_url: null,
				});
			}
			if (url === "https://api.github.com/user/emails") {
				return Response.json([{ email: "contributor@example.com", primary: true, verified: true }]);
			}
			throw new Error(`Unexpected outbound request: ${url}`);
		});
		const callback = await SELF.fetch(`${origin}/api/auth/callback/github?code=mock-code&state=${state}`, {
			headers: { Cookie: stateCookie },
			redirect: "manual",
		});
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe("/");
		expect(outbound).toHaveBeenCalled();
		const sessionCookie = callback.headers
			.getSetCookie()
			.find((cookie) => cookie.startsWith("better-auth.session_token="))!
			.split(";")[0];
		const session = await SELF.fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: sessionCookie } });
		expect(((await session.json()) as { user: { name: string } }).user.name).toBe("Contributor");
		const home = await SELF.fetch(origin, { headers: { Cookie: sessionCookie } });
		expect(await home.text()).toContain("Signed in as Contributor");
		const logout = await SELF.fetch(`${origin}/sign-out`, {
			method: "POST",
			headers: { Cookie: sessionCookie, Origin: origin },
			redirect: "manual",
		});
		expect(logout.status).toBe(303);
		const expired = await SELF.fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: sessionCookie } });
		expect(await expired.json()).toBeNull();
	});
	it("rejects cross-origin sign-in", async () => {
		const response = await SELF.fetch(`${origin}/sign-in`, {
			method: "POST",
			headers: { Origin: "https://attacker.example" },
			redirect: "manual",
		});
		expect(response.status).toBe(403);
		expect(response.headers.get("location")).toBeNull();
	});
	it("rejects OAuth callbacks without a valid state", async () => {
		const before = await env.DB.prepare("SELECT count(*) AS count FROM user").first<{ count: number }>();
		const response = await SELF.fetch(`${origin}/api/auth/callback/github?code=fake&state=fake`, {
			redirect: "manual",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain("error=");
		const users = await env.DB.prepare("SELECT count(*) AS count FROM user").first<{ count: number }>();
		expect(users?.count).toBe(before?.count);
	});
});

describe("Repository coordinator", () => {
	it("initializes SQLite once and retains per-repository state after eviction", async () => {
		const first = env.REPOSITORIES.getByName("repo-a");
		expect(await first.status()).toEqual({ schemaVersion: 1 });
		await runInDurableObject(first, (_object, state) => {
			state.storage.sql.exec("UPDATE metadata SET schema_version = 2 WHERE id = 1");
		});
		await evictDurableObject(first);
		expect(await env.REPOSITORIES.getByName("repo-a").status()).toEqual({ schemaVersion: 2 });
		expect(await env.REPOSITORIES.getByName("repo-b").status()).toEqual({ schemaVersion: 1 });
	});
});
