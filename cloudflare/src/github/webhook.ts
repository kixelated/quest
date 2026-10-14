import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export function positiveId(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function webhookSignature(secret: string, signature: string | undefined, bytes: ArrayBuffer) {
	if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const digest = Uint8Array.from(signature.slice(7).match(/../g)!, (value) => parseInt(value, 16));
	return crypto.subtle.verify("HMAC", key, digest, bytes);
}

const observed = new Set([
	"push",
	"issues",
	"issue_comment",
	"pull_request",
	"pull_request_review",
	"check_run",
	"check_suite",
	"status",
]);
const lifecycle = new Map([
	["created", false],
	["deleted", true],
	["suspend", true],
	["unsuspend", false],
	["new_permissions_accepted", false],
]);

export const githubWebhooks = new Hono<{ Bindings: Env }>();
githubWebhooks.use("/webhooks/github", bodyLimit({ maxSize: 25 * 1024 * 1024 }));
githubWebhooks.post("/webhooks/github", async (c) => {
	if (!c.env.GITHUB_WEBHOOK_SECRET || !c.env.GITHUB_APP_ID) return c.json({ error: "App not configured" }, 503);
	const bytes = await c.req.arrayBuffer();
	if (!(await webhookSignature(c.env.GITHUB_WEBHOOK_SECRET, c.req.header("X-Hub-Signature-256"), bytes))) {
		return c.json({ error: "Invalid signature" }, 403);
	}
	const delivery = c.req.header("X-GitHub-Delivery");
	const event = c.req.header("X-GitHub-Event");
	if (!delivery || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || !event)
		return c.json({ error: "Invalid delivery" }, 400);
	let payload;
	try {
		payload = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
	} catch {
		return c.json({ error: "Invalid payload" }, 400);
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return c.json({ error: "Invalid payload" }, 400);
	if (event !== "ping" && event !== "installation" && event !== "installation_repositories" && !observed.has(event)) {
		return c.json({ status: "ignored" }, 202);
	}
	const installation = payload.installation?.id ?? null;
	const repository = payload.repository?.id ?? null;
	const action = typeof payload.action === "string" ? payload.action : null;
	if (event !== "ping" && !positiveId(installation)) return c.json({ error: "Invalid installation" }, 400);
	if (
		event === "installation" &&
		(String(payload.installation.app_id) !== c.env.GITHUB_APP_ID || !lifecycle.has(action!))
	) {
		return c.json({ error: "Invalid installation event" }, 400);
	}
	if (event === "installation_repositories" && action !== "added" && action !== "removed") {
		return c.json({ error: "Invalid repository event" }, 400);
	}
	if (observed.has(event) && !positiveId(repository)) return c.json({ error: "Invalid repository" }, 400);
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const previous = await c.env.DB.prepare("SELECT digest,event FROM github_deliveries WHERE id=?")
		.bind(delivery)
		.first<{ digest: string; event: string }>();
	if (previous) {
		if (previous.digest !== digest || previous.event !== event) return c.json({ error: "Delivery conflict" }, 409);
		return c.json({ status: "duplicate" });
	}
	const statements = [
		c.env.DB.prepare(
			"INSERT OR IGNORE INTO github_deliveries(id,digest,event,installation,repository,action,receivedAt) VALUES(?,?,?,?,?,?,?)",
		).bind(delivery, digest, event, installation, repository, action, Date.now()),
	];
	// D1 batch is a transaction. The processed predicate prevents concurrent
	// duplicates from applying a lifecycle transition twice.
	if (event === "installation") {
		statements.push(
			c.env.DB.prepare(
				`INSERT INTO github_installations(id,blocked,action)
			SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM github_deliveries WHERE id=? AND digest=? AND event=? AND processed=0)
			ON CONFLICT(id) DO UPDATE SET blocked=excluded.blocked, action=excluded.action, revision=github_installations.revision+1`,
			).bind(installation, lifecycle.get(action!) ? 1 : 0, action, delivery, digest, event),
		);
	} else if (event === "installation_repositories") {
		statements.push(
			c.env.DB.prepare(
				`UPDATE github_installations SET revision=revision+1, action=?
			WHERE id=? AND EXISTS(SELECT 1 FROM github_deliveries WHERE id=? AND digest=? AND event=? AND processed=0)`,
			).bind(`repositories_${action}`, installation, delivery, digest, event),
		);
	}
	statements.push(
		c.env.DB.prepare("UPDATE github_deliveries SET processed=1 WHERE id=? AND digest=? AND event=?").bind(
			delivery,
			digest,
			event,
		),
	);
	await c.env.DB.batch(statements);
	// Observations never approve or launch work. Trusted consumers reconcile
	// current GitHub state rather than treating delayed webhook bodies as facts.
	return c.json({ status: "accepted" }, 202);
});
