import { SELF } from "cloudflare:test";
import { vi } from "vitest";
export const origin = "http://localhost:8787";
export function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}
export function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}
export function join(...items: Uint8Array[]): Uint8Array {
	const all = new Uint8Array(items.reduce((size, item) => size + item.length, 0));
	let offset = 0;
	for (const item of items) {
		all.set(item, offset);
		offset += item.length;
	}
	return all;
}
export function cookie(response: Response, prefix: string): string {
	return response.headers
		.getSetCookie()
		.find((value) => value.startsWith(prefix + "="))!
		.split(";")[0];
}
export async function oauth(
	provider: "github" | "google" = "github",
	email = `${provider}@example.test`,
	linkCookie?: string,
) {
	const start = linkCookie
		? await SELF.fetch(origin + "/api/auth/link-social", {
				method: "POST",
				headers: { Origin: origin, Cookie: linkCookie, "Content-Type": "application/json" },
				body: JSON.stringify({ provider, callbackURL: "/account" }),
				redirect: "manual",
			})
		: await SELF.fetch(origin + (provider === "github" ? "/sign-in" : "/sign-in/google"), {
				method: "POST",
				headers: { Origin: origin },
				redirect: "manual",
			});
	const url = new URL(linkCookie ? ((await start.json()) as { url: string }).url : start.headers.get("location")!);
	const state = url.searchParams.get("state")!,
		stateCookie = cookie(start, "better-auth.state");
	const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const target = input instanceof Request ? input.url : String(input);
		if (target === "https://github.com/login/oauth/access_token")
			return Response.json({ access_token: "fixture-token", token_type: "bearer" });
		if (target === "https://api.github.com/user")
			return Response.json({ id: 2345, login: "person", name: "Person", email, avatar_url: null });
		if (target === "https://api.github.com/user/emails")
			return Response.json([{ email, primary: true, verified: true }]);
		if (target === "https://oauth2.googleapis.com/token")
			return Response.json({
				access_token: "fixture-google-token",
				token_type: "Bearer",
				expires_in: 3600,
				id_token: `${base64(bytes(JSON.stringify({ alg: "RS256" })))}.${base64(bytes(JSON.stringify({ sub: "google-subject", name: "Google Person", email, email_verified: true, picture: null })))}.fixture-signature`,
			});
		throw new Error("Unexpected OAuth fixture URL: " + target);
	});
	try {
		const response = await SELF.fetch(origin + `/api/auth/callback/${provider}?code=fixture&state=${state}`, {
			headers: { Cookie: [stateCookie, linkCookie].filter(Boolean).join("; ") },
			redirect: "manual",
		});
		const session = response.headers.getSetCookie().some((value) => value.startsWith("better-auth.session_token="))
			? cookie(response, "better-auth.session_token")
			: linkCookie;
		return { response, session: session!, outbound, start };
	} finally {
		outbound.mockRestore();
	}
}
export function cbor(value: unknown): Uint8Array {
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
export async function authenticator() {
	const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair,
		jwk = (await crypto.subtle.exportKey("jwk", key.publicKey)) as JsonWebKey;
	const decode = (data: string) =>
		Uint8Array.from(atob(data.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
	const credential = crypto.getRandomValues(new Uint8Array(32)),
		id = base64(credential),
		rp = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes("localhost")));
	const cose = cbor(
		new Map<number, unknown>([
			[1, 2],
			[3, -7],
			[-1, 1],
			[-2, decode(jwk.x!)],
			[-3, decode(jwk.y!)],
		]),
	);
	const client = (type: string, challenge: string, site = origin) =>
		bytes(JSON.stringify({ type, challenge, origin: site, crossOrigin: false }));
	return {
		id,
		registration(challenge: string, userVerified = true) {
			const data = join(
				rp,
				new Uint8Array([userVerified ? 0x45 : 0x41, 0, 0, 0, 0]),
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
					clientDataJSON: base64(client("webauthn.create", challenge)),
					attestationObject: base64(cbor({ fmt: "none", attStmt: {}, authData: data })),
					transports: ["internal"],
				},
				clientExtensionResults: {},
			};
		},
		async assertion(challenge: string, counter = 1, userVerified = true, site = origin) {
			const data = join(
					rp,
					new Uint8Array([
						userVerified ? 5 : 1,
						(counter >>> 24) & 255,
						(counter >>> 16) & 255,
						(counter >>> 8) & 255,
						counter & 255,
					]),
				),
				clientData = client("webauthn.get", challenge, site);
			const raw = new Uint8Array(
				await crypto.subtle.sign(
					{ name: "ECDSA", hash: "SHA-256" },
					key.privateKey,
					join(data, new Uint8Array(await crypto.subtle.digest("SHA-256", clientData))),
				),
			);
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
export async function options(path: string, session?: string) {
	const response = await SELF.fetch(origin + "/api/auth/passkey/generate-" + path + "-options", {
		headers: { Origin: origin, ...(session ? { Cookie: session } : {}) },
		redirect: "manual",
	});
	return {
		response,
		data: (await response.json()) as { challenge: string; rp?: { id: string }; user?: { id: string } },
	};
}
export async function verify(path: string, response: unknown, cookies: string, name?: string) {
	return SELF.fetch(origin + "/api/auth/passkey/verify-" + path, {
		method: "POST",
		headers: { Origin: origin, Cookie: cookies, "Content-Type": "application/json" },
		body: JSON.stringify({ response, name }),
		redirect: "manual",
	});
}
