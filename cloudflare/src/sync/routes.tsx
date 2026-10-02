import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireActor } from "../auth";
import { requireMaintainer, IntakeError, intakeStatus } from "../intake/registry";
import { positiveId } from "./github";
import { dispatchSync } from "./workflow";
import { getPair } from "./service";
import type { Pair } from "./types";
export const syncRoutes = new Hono<{ Bindings: Env }>();
syncRoutes.use("/webhooks/github", bodyLimit({ maxSize: 1048576 }));
syncRoutes.use("/repos/*", bodyLimit({ maxSize: 16384 }));
syncRoutes.onError((error, c) => {
	const status = intakeStatus(error);
	if (status) return c.text(error.message, status);
	console.error({ event: "sync_failed", name: error.name });
	return c.text("Sync unavailable", 500);
});
export async function webhookSignature(
	secret: string,
	signature: string | undefined,
	bytes: ArrayBuffer,
): Promise<boolean> {
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
syncRoutes.post("/webhooks/github", async (c) => {
	const bytes = await c.req.arrayBuffer();
	if (!(await webhookSignature(c.env.GITHUB_WEBHOOK_SECRET, c.req.header("X-Hub-Signature-256"), bytes)))
		throw new IntakeError(403, "Invalid webhook signature");
	if (c.req.header("X-GitHub-Event") !== "push") return c.text("Ignored", 202);
	let payload: unknown;
	try {
		payload = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
	} catch {
		throw new IntakeError(400, "Invalid webhook payload");
	}
	if (!payload || typeof payload !== "object" || !("repository" in payload) || !("installation" in payload))
		throw new IntakeError(400, "Missing webhook identity");
	const { repository, installation } = payload;
	if (
		!repository ||
		typeof repository !== "object" ||
		!("id" in repository) ||
		!positiveId(repository.id) ||
		!installation ||
		typeof installation !== "object" ||
		!("id" in installation) ||
		!positiveId(installation.id)
	)
		throw new IntakeError(400, "Invalid webhook identity");
	const pair = await c.env.DB.prepare(
		"SELECT * FROM github_pairs WHERE githubRepositoryId=? AND installationId=? AND enabled=1",
	)
		.bind(repository.id, installation.id)
		.first<Pair>();
	if (pair)
		await dispatchSync(
			c.env,
			pair.repositoryName,
			`github:${await crypto.subtle.digest("SHA-256", bytes).then((value) => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join(""))}`,
		);
	return c.text("Accepted", 202);
});
syncRoutes.get("/repos/:repository/sync", async (c) => {
	const actor = await requireActor(c.env, c.req.raw.headers);
	const name = c.req.param("repository");
	await requireMaintainer(c.env.DB, name, actor.userId);
	const pair = await getPair(c.env, name);
	const refs = await c.env.DB.prepare(
		"SELECT ref,leftHead,rightHead,status FROM sync_refs WHERE repositoryName=? ORDER BY ref",
	)
		.bind(name)
		.all<{ ref: string; leftHead: string | null; rightHead: string | null; status: string }>();
	c.header("Cache-Control", "no-store");
	return c.html(
		<html lang="en">
			<head>
				<title>GitHub sync</title>
			</head>
			<body>
				<h1>{name} GitHub sync</h1>
				{pair ? (
					<>
						<p>
							{pair.owner}/{pair.name}: {pair.enabled ? "Enabled" : "Disabled"}
						</p>
						<form method="post">
							<input type="hidden" name="action" value={pair.enabled ? "disable" : "enable"} />
							<button>{pair.enabled ? "Disable sync" : "Enable sync after onboarding"}</button>
						</form>
						<form method="post">
							<input type="hidden" name="action" value="sync" />
							<button disabled={!pair.enabled}>Sync now</button>
						</form>
					</>
				) : (
					<form method="post">
						<input type="hidden" name="action" value="pair" />
						<label>
							GitHub repository ID <input type="number" name="repositoryId" required />
						</label>
						<label>
							GitHub App installation ID <input type="number" name="installationId" required />
						</label>
						<button>Pair with sync disabled</button>
					</form>
				)}
				<table>
					<thead>
						<tr>
							<th>Ref</th>
							<th>Artifacts</th>
							<th>GitHub</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{refs.results.map((row) => (
							<tr>
								<td>{row.ref}</td>
								<td>{row.leftHead}</td>
								<td>{row.rightHead}</td>
								<td>{row.status}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p>Diverged or deleted refs require reconciliation in Git; sync never overwrites them.</p>
			</body>
		</html>,
	);
});
syncRoutes.post("/repos/:repository/sync", async (c) => {
	if (c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin)
		throw new IntakeError(403, "Same-origin request required");
	const actor = await requireActor(c.env, c.req.raw.headers),
		repositoryName = c.req.param("repository");
	await requireMaintainer(c.env.DB, repositoryName, actor.userId);
	const body = await c.req.parseBody();
	const coordinator = c.env.REPOSITORIES.getByName(repositoryName);
	if (body.action === "pair")
		await coordinator.pairGithub({
			repositoryName,
			userId: actor.userId,
			githubRepositoryId: Number(body.repositoryId),
			installationId: Number(body.installationId),
		});
	else if (body.action === "enable" || body.action === "disable")
		await coordinator.enableGithub({ repositoryName, userId: actor.userId, enabled: body.action === "enable" });
	else if (body.action !== "sync") throw new IntakeError(400, "Unknown sync action");
	if (body.action !== "pair") await dispatchSync(c.env, repositoryName, crypto.randomUUID());
	return c.redirect(`/repos/${encodeURIComponent(repositoryName)}/sync`, 303);
});
