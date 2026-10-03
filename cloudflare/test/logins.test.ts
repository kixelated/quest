import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth, requireActor } from "../src/auth";
import { oauth, origin, cookie, authenticator, options, verify } from "./login-fixtures";
afterEach(() => vi.restoreAllMocks());
describe("Google and passkey authentication", () => {
	it("offers configured login choices and serves the locally bundled browser client", async () => {
		const home = await SELF.fetch(origin);
		const html = await home.text();
		for (const text of ["Sign in with GitHub", "Sign in with Google", "Sign in with a passkey", "/auth.js"])
			expect(html).toContain(text);
		const script = await SELF.fetch(origin + "/auth.js");
		expect(script.headers.get("content-type")).toContain("text/javascript");
		expect(await script.text()).toContain("verify-authentication");
	});
	it("completes Google OAuth with verified subject attribution and state protection", async () => {
		const login = await oauth("google");
		expect(login.response.status).toBe(302);
		expect(login.response.headers.get("location")).toBe("/");
		expect(await requireActor(env, new Headers({ Cookie: login.session }))).toMatchObject({
			provider: "google",
			identity: "google-subject",
		});
		const account = await SELF.fetch(origin + "/account", { headers: { Cookie: login.session } });
		expect(await account.text()).toContain("google:google-subject");
		const bad = await SELF.fetch(origin + "/api/auth/callback/google?code=fake&state=fake", { redirect: "manual" });
		expect(bad.headers.get("location")).toContain("error=");
	});
	it("enrolls a verified passkey, signs in using a real signature, authenticates the enrolled account, and rejects replay", async () => {
		const login = await oauth(),
			device = await authenticator();
		const registration = await options("register", login.session);
		expect(registration.response.status).toBe(200);
		const challengeCookie = cookie(registration.response, "better-auth.better-auth-passkey");
		const enrolled = await verify(
			"registration",
			device.registration(registration.data.challenge),
			login.session + "; " + challengeCookie,
			"Security key",
		);
		expect(enrolled.status).toBe(200);
		const page = await SELF.fetch(origin + "/account", { headers: { Cookie: login.session } });
		expect(await page.text()).toContain("Security key");
		const authentication = await options("authenticate");
		const authCookie = cookie(authentication.response, "better-auth.better-auth-passkey");
		const assertion = await device.assertion(authentication.data.challenge);
		const signed = await verify("authentication", assertion, authCookie);
		expect(signed.status).toBe(200);
		const session = cookie(signed, "better-auth.session_token");
		expect((await createAuth(env).api.getSession({ headers: new Headers({ Cookie: session }) }))?.user.id).toBe(
			(await requireActor(env, new Headers({ Cookie: login.session }))).userId,
		);
		expect((await verify("authentication", assertion, authCookie)).status).toBe(400);
	});
	it("keeps provider linking closed while its product policy is pending", async () => {
		const login = await oauth("google");
		const response = await SELF.fetch(origin + "/api/auth/link-social", {
			method: "POST",
			headers: { Origin: origin, Cookie: login.session, "Content-Type": "application/json" },
			body: JSON.stringify({ provider: "github", callbackURL: "/account" }),
		});
		expect(response.status).toBe(503);
		const page = await SELF.fetch(origin + "/account", { headers: { Cookie: login.session } });
		expect(await page.text()).not.toContain('data-auth-action="link"');
		expect(await requireActor(env, new Headers({ Cookie: login.session }))).toMatchObject({
			provider: "google",
			identity: "google-subject",
		});
	});
	it("requires a session for enrollment and rejects unverified authenticators", async () => {
		expect((await options("register")).response.status).toBe(401);
		const login = await oauth(),
			device = await authenticator(),
			registration = await options("register", login.session);
		const enrolled = await verify(
			"registration",
			device.registration(registration.data.challenge, false),
			login.session + "; " + cookie(registration.response, "better-auth.better-auth-passkey"),
		);
		expect(enrolled.status).toBe(403);
		expect(await env.DB.prepare("SELECT id FROM passkey WHERE credentialID=?").bind(device.id).first()).toBeNull();
	});
	it("rejects authenticating without user verification, a wrong origin, or a wrong signature", async () => {
		const login = await oauth(),
			device = await authenticator(),
			registration = await options("register", login.session);
		expect(
			(
				await verify(
					"registration",
					device.registration(registration.data.challenge),
					login.session + "; " + cookie(registration.response, "better-auth.better-auth-passkey"),
				)
			).status,
		).toBe(200);
		for (const [index, invalid] of ["unverified", "origin", "signature"].entries()) {
			const authentication = await options("authenticate");
			const assertion = await device.assertion(
				authentication.data.challenge,
				index + 1,
				invalid !== "unverified",
				invalid === "origin" ? "https://other.example" : origin,
			);
			if (invalid === "signature")
				assertion.response.signature = assertion.response.signature.slice(0, -6) + "AAAAAA";
			const result = await verify(
				"authentication",
				assertion,
				cookie(authentication.response, "better-auth.better-auth-passkey"),
			);
			expect(invalid === "unverified" ? [403] : [400, 401]).toContain(result.status);
			expect(await result.json()).toMatchObject(
				invalid === "unverified"
					? { message: "Passkey user verification required" }
					: { code: "AUTHENTICATION_FAILED" },
			);
			expect(result.headers.getSetCookie().some((value) => value.startsWith("better-auth.session_token="))).toBe(
				false,
			);
		}
	});
	it("rejects foreign-origin mutations and limits removal to the enrolled account", async () => {
		const login = await oauth(),
			device = await authenticator(),
			registration = await options("register", login.session);
		const enrolled = await verify(
			"registration",
			device.registration(registration.data.challenge),
			login.session + "; " + cookie(registration.response, "better-auth.better-auth-passkey"),
		);
		expect(enrolled.status).toBe(200);
		const key = await env.DB.prepare("SELECT id FROM passkey WHERE credentialID=?")
			.bind(device.id)
			.first<{ id: string }>();
		const remove = (session: string, site = origin) =>
			SELF.fetch(origin + "/api/auth/passkey/delete-passkey", {
				method: "POST",
				headers: { Cookie: session, Origin: site, "Content-Type": "application/json" },
				body: JSON.stringify({ id: key!.id }),
			});
		expect((await remove(login.session, "https://other.example")).status).toBe(403);
		expect((await remove("")).status).toBe(401);
		const other = await oauth("google");
		expect((await remove(other.session)).status).toBe(401);
		expect((await remove(login.session)).status).toBe(200);
		expect(await env.DB.prepare("SELECT id FROM passkey WHERE credentialID=?").bind(device.id).first()).toBeNull();
		expect(
			(
				await SELF.fetch(origin + "/sign-in/google", {
					method: "POST",
					headers: { Origin: "https://other.example" },
				})
			).status,
		).toBe(403);
	});
});
