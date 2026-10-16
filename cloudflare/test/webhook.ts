import { env } from "cloudflare:workers";
import app from "../src/index";

/** A GitHub webhook delivery signed with the test secret. */
export async function delivery(
	event: string,
	payload: unknown,
	id = crypto.randomUUID(),
	changes: Record<string, string> = {},
) {
	const body = typeof payload === "string" ? payload : JSON.stringify(payload);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const signature = "sha256=" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
	return app.request(
		"http://localhost:8787/webhooks/github",
		{
			method: "POST",
			headers: { "X-GitHub-Event": event, "X-GitHub-Delivery": id, "X-Hub-Signature-256": signature, ...changes },
			body,
		},
		env,
	);
}
