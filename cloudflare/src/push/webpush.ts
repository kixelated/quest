// Web Push with WebCrypto only: RFC 8291 message encryption (aes128gcm,
// RFC 8188) and RFC 8292 VAPID signing, which the Workers runtime supports
// directly, so there is no push library.

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function unbase64url(text: string): Uint8Array {
	return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** A P-256 key pair in the usual Web Push form: the 65-byte public point and the 32-byte private scalar, base64url. */
export type KeyPair = { publicKey: string; privateKey: string };

// WebCrypto imports a raw private scalar only as a JWK, which also needs the public point.
function jwk(pair: KeyPair): JsonWebKey {
	const point = unbase64url(pair.publicKey);
	if (point.length !== 65 || point[0] !== 4) throw new Error("Expected an uncompressed P-256 public key");
	return {
		kty: "EC",
		crv: "P-256",
		x: base64url(point.slice(1, 33)),
		y: base64url(point.slice(33)),
		d: pair.privateKey,
		ext: true,
	};
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(
		await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
	);
}

/** A browser's push subscription, as `PushSubscription.toJSON()` reports it. */
export type Subscription = { endpoint: string; p256dh: string; auth: string };

/**
 * Encrypt one push message for a subscription as a single aes128gcm record.
 * Tests pass the RFC's fixed sender key and salt; otherwise both are fresh.
 */
export async function encrypt(
	subscription: Subscription,
	plaintext: Uint8Array,
	fixed?: { sender: KeyPair; salt: Uint8Array },
) {
	const receiver = unbase64url(subscription.p256dh);
	const secret = unbase64url(subscription.auth);
	if (receiver.length !== 65 || secret.length !== 16) throw new Error("Invalid push subscription keys");
	const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
	const sender = fixed
		? {
				privateKey: await crypto.subtle.importKey("jwk", jwk(fixed.sender), ecdh, false, ["deriveBits"]),
				publicKey: unbase64url(fixed.sender.publicKey),
			}
		: await (async () => {
				const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
				return {
					privateKey: pair.privateKey,
					publicKey: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
				};
			})();
	const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const peer = await crypto.subtle.importKey("raw", receiver, ecdh, false, []);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: peer } as SubtleCryptoDeriveKeyAlgorithm,
			sender.privateKey,
			256,
		),
	);
	const ikm = await hkdf(secret, shared, concat(encoder.encode("WebPush: info\0"), receiver, sender.publicKey), 32);
	const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	// One record: the plaintext and its last-record delimiter, with no padding.
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: nonce },
		key,
		concat(plaintext, new Uint8Array([2])),
	);
	// The header: salt, record size, and the sender's public key as the key ID.
	const header = new Uint8Array(21);
	header.set(salt);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = sender.publicKey.length;
	return concat(header, sender.publicKey, new Uint8Array(sealed));
}

/** The VAPID `Authorization` header for a push service, signed by the application server key. */
export async function vapid(endpoint: string, keys: KeyPair, subject: string, now: number) {
	const json = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
	// Push services accept at most 24 hours; stay under it.
	const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
	const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json(claims)}`;
	const key = await crypto.subtle.importKey("jwk", jwk(keys), { name: "ECDSA", namedCurve: "P-256" }, false, [
		"sign",
	]);
	// WebCrypto's ECDSA signature is already JWS's raw r||s form.
	const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));
	return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** How a push service's reply leaves a subscription: delivered, gone for good, or failed this time. */
export type Delivery = "sent" | "gone" | "failed";

/**
 * Send one encrypted message. `topic` makes the push service replace an
 * undelivered message with the same topic instead of queueing another.
 */
export async function send(
	subscription: Subscription,
	message: unknown,
	options: { keys: KeyPair; subject: string; topic: string; ttl: number },
): Promise<Delivery> {
	const body = await encrypt(subscription, encoder.encode(JSON.stringify(message)));
	const response = await fetch(subscription.endpoint, {
		method: "POST",
		headers: {
			Authorization: await vapid(subscription.endpoint, options.keys, options.subject, Date.now()),
			"Content-Encoding": "aes128gcm",
			"Content-Type": "application/octet-stream",
			TTL: String(options.ttl),
			Topic: options.topic,
			// Decisions are what the notifications are for, so they should arrive promptly.
			Urgency: "high",
		},
		body,
	});
	await response.body?.cancel();
	if (response.ok) return "sent";
	return response.status === 404 || response.status === 410 ? "gone" : "failed";
}
