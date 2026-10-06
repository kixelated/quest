import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const origin = "http://localhost:8787";

describe("Worker", () => {
	it("serves health and handles unknown routes", async () => {
		expect(await (await SELF.fetch(`${origin}/health`)).json()).toEqual({ status: "ok" });
		expect((await SELF.fetch(`${origin}/missing`)).status).toBe(404);
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
