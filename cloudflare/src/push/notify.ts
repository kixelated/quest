// Push notifications for decisions. Only something that waits on a
// maintainer pushes: an agent's question, an account limit, a stopped job,
// a new issue, or a pull request ready for review. Each notification names
// its project and item and opens that item in the inbox, where every answer
// is made; it carries no answer of its own. One tag per item coalesces
// repeated updates on the device, and one Topic per item at the push service.

import { Hono } from "hono";
import { createAuth } from "../auth";
import { type Enrollment, GitHubService } from "../github/service";
import { title, unread } from "../inbox/model";
import { inboxURL } from "../jobs/routes";
import { type KeyPair, type Subscription, base64url, send } from "./webpush";

/** Why an item pushes, which leads its notification. */
export type Reason = "question" | "publication" | "account" | "failed" | "issue" | "pull";
const reasons: Record<Reason, string> = {
	question: "Agent question",
	publication: "Publishing decision",
	account: "Account limit",
	failed: "Job stopped",
	issue: "New issue",
	pull: "Ready for review",
};

/** A decision item to notify about, and its title when the caller already has it. */
export type Decision = { project: Enrollment; target: string; reason: Reason; title?: string };

/** The application server's VAPID keys, or null where notifications are not configured. */
export function keys(env: Env): KeyPair | null {
	return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
		? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
		: null;
}

/** A device to notify: its subscription and whose it is. */
export type Device = Subscription & { user: string };

/**
 * The devices of everyone whose inbox lists this project: today the
 * maintainer who enrolled it. Delivery rechecks that they still maintain it.
 */
export async function devices(env: Env, project: number): Promise<Device[]> {
	if (!keys(env)) return [];
	const { results } = await env.DB.prepare(
		"SELECT s.endpoint,s.p256dh,s.auth,s.user FROM push_subscriptions s JOIN github_projects p ON p.enrolledBy=s.user WHERE p.id=?",
	)
		.bind(project)
		.all<Device>();
	return results;
}

// Undelivered decisions stay in the inbox, so a day-old push adds nothing.
const TTL = 24 * 60 * 60;

/**
 * Push one decision to the devices of those who still maintain its project,
 * as the inbox requires before showing its items, and forget any device the
 * push service reports gone.
 */
export async function deliver(env: Env, decision: Decision, found: Device[]) {
	const pair = keys(env);
	if (!pair || !found.length) return;
	const { project, target } = decision;
	const github = new GitHubService(env);
	const users = [...new Set(found.map((d) => d.user))];
	const current = await Promise.all(users.map((user) => github.maintains(project, user)));
	const maintainers = users.filter((_, i) => current[i]);
	const targets = found.filter((device) => maintainers.includes(device.user));
	if (!targets.length) return;
	const name = decision.title ?? (await title(env.DB, project, target));
	const tag = `${project.id}/${target}`;
	const topic = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tag)))).slice(
		0,
		32,
	);
	const badges = new Map(
		await Promise.all(maintainers.map(async (user) => [user, await unread(env, user)] as const)),
	);
	const results = await Promise.allSettled(
		targets.map((device) =>
			send(
				device,
				{
					title: `${project.owner}/${project.name}`,
					body: `${reasons[decision.reason]}: ${name.slice(0, 120)}`,
					tag,
					url: inboxURL(project.id, target),
					badge: badges.get(device.user) ?? 0,
				},
				{ keys: pair, subject: new URL(env.AUTH_URL).origin, topic, ttl: TTL },
			),
		),
	);
	const gone = targets.filter((_, i) => {
		const result = results[i]!;
		if (result.status === "rejected" || result.value === "failed")
			console.error({ event: "push_failed", host: new URL(targets[i]!.endpoint).host });
		return result.status === "fulfilled" && result.value === "gone";
	});
	if (gone.length)
		await env.DB.batch(
			gone.map((device) =>
				env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user=?").bind(
					device.endpoint,
					device.user,
				),
			),
		);
}

/**
 * Notify everyone with a device about a decision on a project. A paused
 * project offers no work, so a job that stops after it pauses does not notify.
 */
export async function notify(env: Env, decision: Omit<Decision, "project"> & { project: number }) {
	const targets = await devices(env, decision.project);
	if (!targets.length) return;
	const project = await env.DB.prepare(
		"SELECT id,owner,name,state FROM github_projects WHERE id=? AND state='enabled'",
	)
		.bind(decision.project)
		.first<Enrollment>();
	if (project) await deliver(env, { ...decision, project }, targets);
}

// The push services browsers use. A subscription elsewhere is refused, so a
// client cannot make the Worker post to an arbitrary address.
const services = [
	/^fcm\.googleapis\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^([a-z0-9-]+\.)*push\.apple\.com$/,
	/^([a-z0-9-]+\.)*notify\.windows\.com$/,
];
function endpoint(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 1000) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && services.some((host) => host.test(url.hostname)) ? url.href : null;
	} catch {
		return null;
	}
}
function key(value: unknown, bytes: number) {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
	return Math.floor((value.length * 3) / 4) === bytes ? value : null;
}

/**
 * The signed-in device's subscription. Enabling stores it for this user and
 * session; disabling removes it. The browser asks for permission only from
 * a click on the enable button.
 */
export const subscriptions = new Hono<{ Bindings: Env }>();
subscriptions.use("/push/*", async (c, next) => {
	if (c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin) return c.json({ error: "Invalid origin" }, 403);
	await next();
});
subscriptions.post("/push/subscribe", async (c) => {
	const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "Sign in required" }, 401);
	if (!keys(c.env)) return c.json({ error: "Notifications are not configured" }, 503);
	const body = await c.req.json().catch(() => null);
	const found = endpoint(body?.endpoint);
	const p256dh = key(body?.keys?.p256dh, 65);
	const auth = key(body?.keys?.auth, 16);
	if (!found || !p256dh || !auth) return c.json({ error: "Invalid push subscription" }, 400);
	// A browser that rotated its subscription names the one it replaces. The new
	// one takes its place only if the signed-in user turned that one on, so a
	// rotation never opts in whoever is signed in now.
	const replaces = body?.replaces === undefined ? null : endpoint(body.replaces);
	if (body?.replaces !== undefined && !replaces) return c.json({ error: "Invalid push subscription" }, 400);
	const [stored] = await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO push_subscriptions(endpoint,user,session,p256dh,auth,createdAt)
			SELECT ?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM push_subscriptions WHERE endpoint=? AND user=?)
			ON CONFLICT(endpoint) DO UPDATE SET user=excluded.user,session=excluded.session,p256dh=excluded.p256dh,auth=excluded.auth,createdAt=excluded.createdAt`,
		).bind(
			found,
			session.user.id,
			session.session.id,
			p256dh,
			auth,
			Date.now(),
			replaces,
			replaces,
			session.user.id,
		),
		c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND endpoint<>? AND user=?").bind(
			replaces,
			found,
			session.user.id,
		),
	]);
	if (!stored!.meta.changes) return c.json({ error: "Notifications are not on for this device" }, 403);
	return c.body(null, 204);
});
// Whether the server still notifies the browser's subscription for this user.
// It moves a match to this session, so signing out here forgets it, but never
// takes over another user's device or one that a sign-out forgot: turning
// notifications on again takes a click.
subscriptions.post("/push/check", async (c) => {
	const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "Sign in required" }, 401);
	const body = await c.req.json().catch(() => null);
	if (typeof body?.endpoint !== "string") return c.json({ error: "Endpoint required" }, 400);
	const result = await c.env.DB.prepare("UPDATE push_subscriptions SET session=? WHERE endpoint=? AND user=?")
		.bind(session.session.id, body.endpoint, session.user.id)
		.run();
	return c.json({ stored: result.meta.changes > 0 });
});
subscriptions.post("/push/unsubscribe", async (c) => {
	const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "Sign in required" }, 401);
	const body = await c.req.json().catch(() => null);
	if (typeof body?.endpoint !== "string") return c.json({ error: "Endpoint required" }, 400);
	await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user=?")
		.bind(body.endpoint, session.user.id)
		.run();
	return c.body(null, 204);
});

/** Stop notifying the devices a session enabled, when it signs out. */
export function forget(db: D1Database, session: string) {
	return db.prepare("DELETE FROM push_subscriptions WHERE session=?").bind(session).run();
}

/** How many devices notify a maintainer. */
export async function count(db: D1Database, user: string) {
	return (
		(
			await db
				.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user=?")
				.bind(user)
				.first<{ n: number }>()
		)?.n ?? 0
	);
}

/** Notify about a job that now waits on a maintainer. */
export async function job(env: Env, id: string, reason: Reason) {
	const found = await env.DB.prepare("SELECT repository,target FROM jobs WHERE id=?")
		.bind(id)
		.first<{ repository: number; target: string }>();
	if (found) await notify(env, { project: found.repository, target: found.target, reason });
}

/**
 * Notify about a new issue, or a pull request ready for review, that a
 * webhook reported on an enrolled project. A paused project offers no work
 * on them, so it does not notify. Other updates only refresh the inbox.
 */
export async function arrived(env: Env, repository: number, installation: number, event: string, payload: any) {
	const pull = payload.pull_request;
	const issue = payload.issue;
	let decision: Pick<Decision, "target" | "reason" | "title"> | null = null;
	if (event === "issues" && (payload.action === "opened" || payload.action === "reopened") && !issue?.pull_request)
		decision = { target: `issues/${issue?.number}`, reason: "issue", title: issue?.title };
	else if (
		event === "pull_request" &&
		(payload.action === "ready_for_review" ||
			((payload.action === "opened" || payload.action === "reopened") && pull?.draft === false))
	)
		decision = { target: `pulls/${pull?.number}`, reason: "pull", title: pull?.title };
	if (!decision || !/^(issues|pulls)\/[1-9]\d*$/.test(decision.target)) return;
	if (typeof decision.title !== "string") delete decision.title;
	const project = await env.DB.prepare(
		"SELECT id,owner,name,state FROM github_projects WHERE id=? AND installation=? AND state='enabled'",
	)
		.bind(repository, installation)
		.first<Enrollment>();
	if (!project) return;
	await deliver(env, { ...decision, project }, await devices(env, project.id));
}
