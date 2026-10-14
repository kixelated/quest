import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

const canonical = "https://kix.quest";
const legacy = "https://kixel.quest";
const production = { ...env, AUTH_URL: canonical };
const request = (path: string, init?: RequestInit) => app.fetch(new Request(path, init), production);

describe("Canonical domain", () => {
	it("preserves encoded paths and query parameters on the retired domain", async () => {
		for (const method of ["GET", "HEAD"]) {
			const path = "/repos/quest/quest/m0/space%20%23%3F%25?show=ready&tag=a&tag=b";
			const response = await request(`${legacy}${path}`, { method });
			expect(response.status).toBe(308);
			expect(response.headers.get("location")).toBe(`${canonical}${path}`);
		}
	});
	it("keeps the configured destination host even for network-path input", async () => {
		for (const path of ["//evil.example/a", "/%2f%2fevil.example/a", "/?next=https://evil.example"]) {
			const response = await request(`${legacy}${path}`, {
				headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" },
			});
			expect(new URL(response.headers.get("location")!).origin).toBe(canonical);
		}
	});
	it("redirects legacy asset and setup URLs before serving their contents", async () => {
		for (const path of ["/theme/theme.css", "/theme/logo.svg", "/site.css", "/setup"]) {
			const response = await request(`${legacy}${path}`);
			expect(response.status).toBe(308);
			expect(response.headers.get("location")).toBe(`${canonical}${path}`);
		}
	});
	it("serves canonical assets through the Worker-first assets binding", async () => {
		for (const path of ["/theme/theme.css", "/theme/logo.svg", "/site.css"]) {
			const response = await SELF.fetch(`${canonical}${path}`);
			expect(response.status, path).toBe(200);
			expect((await response.text()).length).toBeGreaterThan(0);
		}
		expect((await SELF.fetch(`${canonical}/theme/missing.svg`)).status).toBe(404);
	});
	it("uses the canonical origin for generated links without redirecting local development", async () => {
		const html = await (await request(canonical)).text();
		expect(html).toContain(`Follow ${canonical}/setup to set up Quest here.`);
		expect(html).toContain(`content="${canonical}/theme/og.png"`);
		for (const origin of [canonical, "http://localhost:8787"]) {
			const response = await request(`${origin}/health`, { headers: { "X-Forwarded-Host": "kixel.quest" } });
			expect(response.status).toBe(200);
			expect(response.headers.get("location")).toBeNull();
		}
	});
	it("restarts legacy authentication without forwarding OAuth secrets or request bodies", async () => {
		const before = await env.DB.prepare("SELECT count(*) AS count FROM verification").first();
		for (const path of [
			"/api/auth/callback/github?code=private-code&state=private-state",
			"/api/auth/get-session?token=private-token",
			"/api/auth",
			"/sign-in?next=//evil.example",
			"/sign-out",
		]) {
			for (const method of ["GET", "POST"]) {
				const response = await request(`${legacy}${path}`, { method });
				expect(response.status).toBe(303);
				expect(response.headers.get("location")).toBe(`${canonical}/`);
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(response.headers.get("set-cookie")).toBeNull();
			}
		}
		expect(await env.DB.prepare("SELECT count(*) AS count FROM verification").first()).toEqual(before);
	});
	it("uses the canonical OAuth callback and rejects the retired origin", async () => {
		const rejected = await request(`${canonical}/sign-in`, { method: "POST", headers: { Origin: legacy } });
		expect(rejected.status).toBe(403);
		const apiRejected = await request(`${canonical}/api/auth/sign-in/social`, {
			method: "POST",
			headers: {
				Origin: legacy,
				Cookie: "better-auth.session_token=existing-session",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ provider: "github", callbackURL: "/" }),
		});
		expect(apiRejected.status).toBe(403);
		const started = await request(`${canonical}/sign-in`, { method: "POST", headers: { Origin: canonical } });
		expect(started.status).toBe(303);
		const oauth = new URL(started.headers.get("location")!);
		expect(oauth.origin).toBe("https://github.com");
		expect(oauth.searchParams.get("redirect_uri")).toBe(`${canonical}/api/auth/callback/github`);
	});
});
