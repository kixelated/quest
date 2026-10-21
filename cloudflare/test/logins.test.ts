import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth";
import { app } from "../src/index";
import { authenticator, cookie, enrolled, identity, oauth, options, origin, verify } from "./login-fixtures";

afterEach(() => vi.restoreAllMocks());

async function userId(session: string): Promise<string> {
	const found = await createAuth(env).api.getSession({ headers: new Headers({ Cookie: session }) });
	return found!.user.id;
}

// The provider identities linked to a session's account.
async function linked(session: string) {
	const { results } = await env.DB.prepare(
		"SELECT providerId, accountId FROM account WHERE userId=? ORDER BY providerId",
	)
		.bind(await userId(session))
		.all<{ providerId: string; accountId: string }>();
	return results.map((row) => `${row.providerId}:${row.accountId}`);
}

function post(path: string, body: Record<string, string>, session?: string, site = origin) {
	return SELF.fetch(`${origin}${path}`, {
		method: "POST",
		headers: { Origin: site, ...(session && { Cookie: session }) },
		body: new URLSearchParams(body),
		redirect: "manual",
	});
}

describe("sign-in choices", () => {
	it("offers GitHub, Google, and passkeys", async () => {
		const html = await (await SELF.fetch(`${origin}/sign-in?next=/docs`)).text();
		for (const text of ["Sign in with GitHub", "Sign in with Google", "Sign in with a passkey", "/passkey.js"])
			expect(html).toContain(text);
		expect(html).toContain('data-next="/docs"');
	});
	it("links the nav to the sign-in page, returning to the current page", async () => {
		const html = await (await SELF.fetch(`${origin}/docs`)).text();
		expect(html).toContain('href="/sign-in?next=%2Fdocs"');
		const unsafe = await (await SELF.fetch(`${origin}/sign-in?next=//evil.example`)).text();
		expect(unsafe).toContain('data-next="/inbox"');
	});
	it("omits Google until both of its credentials are configured", async () => {
		const unconfigured = { ...env, GOOGLE_CLIENT_SECRET: undefined };
		const page = await app.fetch(new Request(`${origin}/sign-in`), unconfigured);
		expect(await page.text()).not.toContain("Sign in with Google");
		const start = await app.fetch(
			new Request(`${origin}/sign-in`, {
				method: "POST",
				headers: { Origin: origin },
				body: new URLSearchParams({ provider: "google" }),
			}),
			unconfigured,
		);
		expect(start.status).toBe(400);
		expect((await post("/sign-in", { provider: "password" })).status).toBe(400);
	});
	it("starts Google OAuth with persisted state", async () => {
		const response = await post("/sign-in", { provider: "google", next: "/docs" });
		expect(response.status).toBe(303);
		const location = new URL(response.headers.get("location")!);
		expect(location.origin).toBe("https://accounts.google.com");
		expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
		expect(cookie(response, "better-auth.state")).toBeTruthy();
	});
});

describe("Google sign-in", () => {
	it("creates its own account, without GitHub authority", async () => {
		const who = identity("google");
		const { response, session } = await oauth(who);
		expect(response.headers.get("location")).toBe("/inbox");
		expect(await linked(session!)).toEqual([`google:${who.id}`]);
		const page = await (await SELF.fetch(`${origin}/account`, { headers: { Cookie: session! } })).text();
		expect(page).toContain("Link GitHub to act on repositories");
		expect(page).toContain("Link GitHub</button>");
	});
	it("never joins an existing account by matching email", async () => {
		const github = identity("github");
		await oauth(github);
		const { response, session } = await oauth(identity("google", github.email));
		expect(response.headers.get("location")).toBe("/sign-in?error=account_not_linked");
		expect(session).toBeUndefined();
		const page = await (await SELF.fetch(`${origin}${response.headers.get("location")}`)).text();
		expect(page).toContain("link this one from your account page");
		const owners = await env.DB.prepare("SELECT count(*) AS count FROM account WHERE accountId=?")
			.bind(github.id)
			.first<{ count: number }>();
		expect(owners?.count).toBe(1);
	});
});

describe("account linking", () => {
	it("links Google to a GitHub account, across different emails", async () => {
		const github = identity("github");
		const google = identity("google");
		const { session } = await oauth(github);
		const link = await oauth(google, session);
		expect(link.response.headers.get("location")).toBe("/account");
		expect(await linked(session!)).toEqual([`github:${github.id}`, `google:${google.id}`]);
		// Signing in with the linked provider reaches the same account.
		const again = await oauth(google);
		expect(await userId(again.session!)).toBe(await userId(session!));
	});
	it("links GitHub to a Google account, which is what grants repository authority", async () => {
		const google = identity("google");
		const github = identity("github");
		const { session } = await oauth(google);
		await oauth(github, session);
		expect(await linked(session!)).toEqual([`github:${github.id}`, `google:${google.id}`]);
		const page = await (await SELF.fetch(`${origin}/account`, { headers: { Cookie: session! } })).text();
		expect(page).toContain("Repository access comes from your linked GitHub account");
	});
	it("rejects a provider identity that belongs to another account", async () => {
		const google = identity("google");
		await oauth(google);
		const { session } = await oauth(identity("github"));
		const link = await oauth(google, session);
		expect(link.response.headers.get("location")).toBe("/account?error=account_already_linked_to_different_user");
		expect(await linked(session!)).toHaveLength(1);
		const page = await (
			await SELF.fetch(`${origin}${link.response.headers.get("location")}`, { headers: { Cookie: session! } })
		).text();
		expect(page).toContain("already belongs to a different account");
	});
	it("rejects a second GitHub identity on one account", async () => {
		const github = identity("github");
		const { session } = await oauth(github);
		const link = await oauth(identity("github"), session);
		expect(link.response.headers.get("location")).toBe("/account?error=unable_to_link_account");
		expect(await linked(session!)).toEqual([`github:${github.id}`]);
	});
	it("requires a same-origin, signed-in request and keeps unlinking closed", async () => {
		const { session } = await oauth(identity("github"));
		expect((await post("/link", { provider: "google" })).status).toBe(401);
		expect((await post("/link", { provider: "google" }, session, "https://evil.example")).status).toBe(403);
		const unlink = await SELF.fetch(`${origin}/api/auth/unlink-account`, {
			method: "POST",
			headers: { Origin: origin, Cookie: session!, "Content-Type": "application/json" },
			body: JSON.stringify({ providerId: "github" }),
		});
		expect(unlink.status).toBe(404);
		expect(await linked(session!)).toHaveLength(1);
	});
	it("sends a signed-out visitor from the account page to sign in", async () => {
		const response = await SELF.fetch(`${origin}/account`, { redirect: "manual" });
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/sign-in?next=/account");
	});
});

describe("passkeys", () => {
	it("enrolls on a signed-in account and signs in to it with a real signature", async () => {
		const { session, device } = await enrolled();
		const page = await (await SELF.fetch(`${origin}/account`, { headers: { Cookie: session } })).text();
		expect(page).toContain('action="/passkeys/delete"');

		const authentication = await options("authenticate");
		const assertion = await device.assertion(authentication.challenge, 1);
		const signed = await verify("authentication", assertion, authentication.cookies);
		expect(signed.status).toBe(200);
		const passkeySession = cookie(signed, "better-auth.session_token")!;
		expect(await userId(passkeySession)).toBe(await userId(session));
		// Each challenge is single use.
		expect((await verify("authentication", assertion, authentication.cookies)).status).toBe(400);
	});
	it("requires a session and user verification to enroll", async () => {
		expect((await options("register")).response.status).toBe(401);
		const { session } = await oauth(identity("github"));
		const device = await authenticator();
		const registration = await options("register", session);
		const response = await verify(
			"registration",
			device.registration(registration.challenge, false),
			registration.cookies,
		);
		expect(response.status).toBe(403);
		const stored = await env.DB.prepare("SELECT id FROM passkey WHERE credentialID=?").bind(device.id).first();
		expect(stored).toBeNull();
	});
	it("rejects assertions without user verification, from another origin, or with a bad signature", async () => {
		const { device } = await enrolled();
		for (const [counter, problem] of (["unverified", "origin", "signature"] as const).entries()) {
			const authentication = await options("authenticate");
			const assertion = await device.assertion(
				authentication.challenge,
				counter + 1,
				problem !== "unverified",
				problem === "origin" ? "https://evil.example" : origin,
			);
			if (problem === "signature")
				assertion.response.signature = assertion.response.signature.slice(0, -6) + "AAAAAA";
			const response = await verify("authentication", assertion, authentication.cookies);
			expect(response.ok, problem).toBe(false);
			expect(cookie(response, "better-auth.session_token"), problem).toBeUndefined();
		}
	});
	it("removes a passkey only for its owner, from this origin", async () => {
		const { session, device } = await enrolled();
		const key = await env.DB.prepare("SELECT id FROM passkey WHERE credentialID=?")
			.bind(device.id)
			.first<{ id: string }>();
		const other = await oauth(identity("github"));
		expect((await post("/passkeys/delete", { id: key!.id }, session, "https://evil.example")).status).toBe(403);
		expect((await post("/passkeys/delete", { id: key!.id })).status).toBe(401);
		expect((await post("/passkeys/delete", { id: key!.id }, other.session)).ok).toBe(false);
		const removed = await post("/passkeys/delete", { id: key!.id }, session);
		expect(removed.status).toBe(303);
		expect(removed.headers.get("location")).toBe("/account");
		expect(await env.DB.prepare("SELECT id FROM passkey WHERE id=?").bind(key!.id).first()).toBeNull();
	});
});
