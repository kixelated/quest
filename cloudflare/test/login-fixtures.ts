// Mocked OAuth providers and a software P-256 authenticator for login tests.
import { SELF } from "cloudflare:test";
import { vi } from "vitest";

export const origin = "http://localhost:8787";

export function base64(data: Uint8Array): string {
	return btoa(String.fromCharCode(...data))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function join(...items: Uint8Array[]): Uint8Array {
	const all = new Uint8Array(items.reduce((size, item) => size + item.length, 0));
	let offset = 0;
	for (const item of items) {
		all.set(item, offset);
		offset += item.length;
	}
	return all;
}

export function cookie(response: Response, name: string): string | undefined {
	return response.headers
		.getSetCookie()
		.find((value) => value.startsWith(`${name}=`))
		?.split(";")[0];
}

// A fresh provider identity, so tests sharing one database never collide by accident.
let next = 1000;
export function identity(provider: "github" | "google", email?: string) {
	const id = String(next++);
	return { provider, id, email: email ?? `${provider}-${id}@example.test` };
}
export type Identity = ReturnType<typeof identity>;

/**
 * Complete a mocked OAuth flow for `who`: sign in, or with `session`, link it to
 * that signed-in account. Returns the callback response and the session after it.
 */
export async function oauth(who: Identity, session?: string) {
	const start = await SELF.fetch(`${origin}/${session ? "link" : "sign-in"}`, {
		method: "POST",
		headers: { Origin: origin, ...(session && { Cookie: session }) },
		body: new URLSearchParams({ provider: who.provider }),
		redirect: "manual",
	});
	if (start.status !== 303) throw new Error(`OAuth start failed: ${start.status}`);
	const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
	const stateCookie = cookie(start, "better-auth.state")!;
	const claims = { sub: who.id, name: `Person ${who.id}`, email: who.email, email_verified: true };
	const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url === "https://github.com/login/oauth/access_token")
			return Response.json({ access_token: "mock-token", token_type: "bearer" });
		if (url === "https://api.github.com/user")
			return Response.json({ id: Number(who.id), login: `person${who.id}`, name: claims.name, email: who.email });
		if (url === "https://api.github.com/user/emails")
			return Response.json([{ email: who.email, primary: true, verified: true }]);
		if (url === "https://oauth2.googleapis.com/token")
			return Response.json({
				access_token: "mock-google-token",
				token_type: "Bearer",
				expires_in: 3600,
				id_token: `${base64(bytes(JSON.stringify({ alg: "RS256" })))}.${base64(bytes(JSON.stringify(claims)))}.sig`,
			});
		throw new Error(`Unexpected outbound request: ${url}`);
	});
	try {
		const response = await SELF.fetch(`${origin}/api/auth/callback/${who.provider}?code=mock&state=${state}`, {
			headers: { Cookie: [stateCookie, session].filter(Boolean).join("; ") },
			redirect: "manual",
		});
		return { response, session: cookie(response, "better-auth.session_token") ?? session };
	} finally {
		outbound.mockRestore();
	}
}

// Minimal CBOR encoding for attestation objects and COSE keys.
function cbor(value: unknown): Uint8Array {
	const header = (major: number, size: number) =>
		size < 24
			? new Uint8Array([major * 32 + size])
			: size < 256
				? new Uint8Array([major * 32 + 24, size])
				: new Uint8Array([major * 32 + 25, size >> 8, size & 255]);
	if (typeof value === "number") return value < 0 ? header(1, -value - 1) : header(0, value);
	if (typeof value === "string") {
		const data = bytes(value);
		return join(header(3, data.length), data);
	}
	if (value instanceof Uint8Array) return join(header(2, value.length), value);
	const entries = value instanceof Map ? [...value] : Object.entries(value as object);
	return join(header(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)]));
}

/** A software authenticator with a real P-256 key, for registration and assertions. */
export async function authenticator() {
	const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const jwk = (await crypto.subtle.exportKey("jwk", key.publicKey)) as JsonWebKey;
	const decode = (data: string) =>
		Uint8Array.from(atob(data.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
	const credential = crypto.getRandomValues(new Uint8Array(32));
	const id = base64(credential);
	const rp = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(new URL(origin).hostname)));
	const cose = cbor(
		new Map<number, unknown>([
			[1, 2],
			[3, -7],
			[-1, 1],
			[-2, decode(jwk.x!)],
			[-3, decode(jwk.y!)],
		]),
	);
	const client = (type: string, challenge: string, site: string) =>
		bytes(JSON.stringify({ type, challenge, origin: site, crossOrigin: false }));
	// Flags: user present (0x01), user verified (0x04), attested credential data (0x40).
	const flags = (verified: boolean, attested: boolean) => (verified ? 0x05 : 0x01) | (attested ? 0x40 : 0);
	return {
		id,
		registration(challenge: string, verified = true) {
			const data = join(
				rp,
				new Uint8Array([flags(verified, true), 0, 0, 0, 0]),
				new Uint8Array(16),
				new Uint8Array([0, credential.length]),
				credential,
				cose,
			);
			return {
				id,
				rawId: id,
				type: "public-key",
				response: {
					clientDataJSON: base64(client("webauthn.create", challenge, origin)),
					attestationObject: base64(cbor({ fmt: "none", attStmt: {}, authData: data })),
					transports: ["internal"],
				},
				clientExtensionResults: {},
			};
		},
		async assertion(challenge: string, counter: number, verified = true, site = origin) {
			const count = new Uint8Array(4);
			new DataView(count.buffer).setUint32(0, counter);
			const data = join(rp, new Uint8Array([flags(verified, false)]), count);
			const clientData = client("webauthn.get", challenge, site);
			const raw = new Uint8Array(
				await crypto.subtle.sign(
					{ name: "ECDSA", hash: "SHA-256" },
					key.privateKey,
					join(data, new Uint8Array(await crypto.subtle.digest("SHA-256", clientData))),
				),
			);
			// WebAuthn signatures are DER, not WebCrypto's raw r||s.
			const integer = (part: Uint8Array) => {
				while (part.length > 1 && part[0] === 0) part = part.slice(1);
				if (part[0] & 128) part = join(new Uint8Array([0]), part);
				return join(new Uint8Array([2, part.length]), part);
			};
			const sig = join(integer(raw.slice(0, 32)), integer(raw.slice(32)));
			return {
				id,
				rawId: id,
				type: "public-key",
				response: {
					clientDataJSON: base64(clientData),
					authenticatorData: base64(data),
					signature: base64(join(new Uint8Array([0x30, sig.length]), sig)),
				},
				clientExtensionResults: {},
			};
		},
	};
}

// Request ceremony options; the challenge cookie binds them to the verify call.
export async function options(ceremony: "register" | "authenticate", session?: string) {
	const response = await SELF.fetch(`${origin}/api/auth/passkey/generate-${ceremony}-options`, {
		headers: { Origin: origin, ...(session && { Cookie: session }) },
	});
	const challenge = cookie(response, "better-auth.better-auth-passkey");
	const data = response.ok ? ((await response.json()) as { challenge: string }) : null;
	return { response, challenge: data?.challenge ?? "", cookies: [session, challenge].filter(Boolean).join("; ") };
}

export function verify(ceremony: "registration" | "authentication", response: unknown, cookies: string) {
	return SELF.fetch(`${origin}/api/auth/passkey/verify-${ceremony}`, {
		method: "POST",
		headers: { Origin: origin, Cookie: cookies, "Content-Type": "application/json" },
		body: JSON.stringify({ response }),
	});
}

/** Sign in with GitHub and enroll a passkey on that account. */
export async function enrolled() {
	const { session } = await oauth(identity("github"));
	const device = await authenticator();
	const registration = await options("register", session);
	const response = await verify("registration", device.registration(registration.challenge), registration.cookies);
	if (!response.ok) throw new Error(`Enrollment failed: ${response.status}`);
	return { session: session!, device };
}
