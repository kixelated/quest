import { env } from "cloudflare:workers";
import { runInDurableObject, introspectWorkflowInstance } from "cloudflare:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { appJwt, withGithub } from "../src/sync/github";
import { pairGithub, getPair, enableGithub, syncGithub } from "../src/sync/service";
import { syncRoutes, webhookSignature } from "../src/sync/routes";
import { dispatchArtifactsSync, pollSync } from "../src/sync/workflow";
import type { Pair } from "../src/sync/types";
import type { PushEvent } from "../src/intake/events";
const repositoryName = "sync-repo",
	userId = "sync-owner",
	head = "a".repeat(40);
const pair: Pair = {
	repositoryName,
	githubRepositoryId: 123,
	installationId: 456,
	owner: "owner",
	name: "project",
	enabled: 1,
	subscriptionId: "subscription",
};
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const repo = {
	id: 123,
	name: "project",
	owner: { login: "owner" },
	default_branch: "main",
	archived: false,
	disabled: false,
};
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM sync_refs"),
		env.DB.prepare("DELETE FROM github_pairs"),
		env.DB.prepare("INSERT OR IGNORE INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)").bind(
			userId,
			"Owner",
			"private-sync@example.test",
			0,
			0,
		),
		env.DB.prepare(
			"INSERT OR IGNORE INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
		).bind("sync-account", "789", "github", userId, 0, 0),
		env.DB.prepare("INSERT OR IGNORE INTO repositories VALUES(?,?,?,?,?)").bind(
			repositoryName,
			"https://git.test/upstream",
			"main",
			userId,
			0,
		),
	]);
});
function fixture() {
	const createBatch = vi.fn(async (items: { id: string }[]) => items);
	const mirror = vi.fn(async () =>
		Object.assign([{ ref: "refs/heads/main", left: head, right: head, status: "equal", shared: head }], {
			[Symbol.dispose]() {},
		}),
	);
	const revokeToken = vi.fn(async () => {});
	const bindings = {
		...env,
		GITHUB_APP_ID: "42",
		GITHUB_APP_PRIVATE_KEY: privateKey,
		GITHUB_WEBHOOK_SECRET: "webhook-test-secret",
		EVENT_ACCOUNT_ID: "f".repeat(32),
		EVENT_QUEUE_ID: "e".repeat(32),
		EVENT_SUBSCRIPTION_TOKEN: "management-test",
		ARTIFACTS_NAMESPACE: "quest",
		GITHUB_SYNC: { createBatch },
		GIT: {
			getByName: () => ({
				mirror,
				refs: async () => Object.assign({ "refs/heads/main": head }, { [Symbol.dispose]() {} }),
			}),
		},
		ARTIFACTS: {
			get: async () => ({
				[Symbol.dispose]() {},
				info: async () => ({ remote: "https://git.test/upstream" }),
				createToken: async () => ({ id: "ephemeral", plaintext: "private-artifacts-token" }),
				revokeToken,
			}),
		},
	} as unknown as Env;
	let permission = "admin",
		permissionId = 789;
	const calls = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = String(input),
			method = init?.method ?? "GET";
		if (url.endsWith("/access_tokens")) {
			expect(JSON.parse(init!.body as string)).toEqual({
				repository_ids: [123],
				permissions: { contents: "write", workflows: "write" },
			});
			return Response.json({
				token: "ghs_new_long_token_format",
				permissions: { contents: "write", workflows: "write" },
			});
		}
		if (url.endsWith("/installation/token") && method === "DELETE") return new Response(null, { status: 204 });
		if (url.endsWith("/user/789")) return Response.json({ id: 789, login: "verified-owner" });
		if (url.endsWith("/repositories/123")) return Response.json(repo);
		if (url.endsWith("/collaborators/verified-owner/permission"))
			return Response.json({ permission, user: { id: permissionId } });
		if (url.includes("event_subscriptions/subscriptions?")) return Response.json({ success: true, result: [] });
		if (url.endsWith("event_subscriptions/subscriptions") && method === "POST")
			return Response.json({ success: true, result: { id: "subscription" } });
		throw new Error(`Unexpected fixture request ${url}`);
	});
	return {
		bindings,
		createBatch,
		mirror,
		revokeToken,
		calls,
		setPermissionId(value: number) {
			permissionId = value;
		},
		setPermission(value: string) {
			permission = value;
		},
	};
}
async function sessionCookie() {
	const token = "sync-session";
	await env.DB.prepare(
		"INSERT OR REPLACE INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
	)
		.bind(token, Date.now() + 3600000, token, Date.now(), Date.now(), userId)
		.run();
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.AUTH_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signed = btoa(
		String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)))),
	);
	return "better-auth.session_token=" + encodeURIComponent(token + "." + signed);
}
async function seedPair(enabled = 1) {
	await env.DB.prepare("INSERT INTO github_pairs VALUES(?,?,?,?,?,?,?)")
		.bind(repositoryName, 123, 456, "owner", "project", enabled, "subscription")
		.run();
}
async function signature(secret: string, body: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return (
		"sha256=" +
		Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")
	);
}
function event(): PushEvent {
	return {
		type: "cf.artifacts.repo.pushed",
		source: { type: "artifacts.repo", namespace: "quest", repoName: repositoryName },
		payload: { ref: "refs/notes/quest", before: head, after: "b".repeat(40) },
		metadata: {
			accountId: "f".repeat(32),
			eventSubscriptionId: "subscription",
			eventTimestamp: new Date().toISOString(),
			eventSchemaVersion: 1,
		},
	};
}
describe("GitHub sync security and orchestration", () => {
	it("signs short-lived App JWTs and revokes repository-scoped installation tokens", async () => {
		const f = fixture();
		const jwt = appJwt(f.bindings),
			parts = jwt.split(".");
		expect(
			verify(
				"RSA-SHA256",
				Buffer.from(parts.slice(0, 2).join(".")),
				keys.publicKey,
				Buffer.from(parts[2], "base64url"),
			),
		).toBe(true);
		const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
		expect(claims.exp - claims.iat).toBe(600);
		await expect(
			withGithub(f.bindings, pair, async (capability) => {
				expect(capability.remote).toBe("https://github.com/owner/project.git");
				expect(atob(capability.authorization!.slice(6))).toBe("x-access-token:ghs_new_long_token_format");
				throw new Error("Operation failed");
			}),
		).rejects.toThrow("Operation failed");
		expect(
			f.calls.mock.calls.some(
				([url, init]) => String(url).endsWith("/installation/token") && init?.method === "DELETE",
			),
		).toBe(true);
	});
	it("requires both Artifacts maintainer and verified GitHub admin, with pairing initially disabled", async () => {
		const f = fixture();
		await expect(
			pairGithub(f.bindings, {
				repositoryName,
				userId: "intruder",
				githubRepositoryId: 123,
				installationId: 456,
			}),
		).rejects.toThrow("Maintainer");
		f.setPermission("write");
		await expect(
			pairGithub(f.bindings, { repositoryName, userId, githubRepositoryId: 123, installationId: 456 }),
		).rejects.toThrow("administrator");
		expect(await getPair(f.bindings, repositoryName)).toBeNull();
		f.setPermission("admin");
		await pairGithub(f.bindings, { repositoryName, userId, githubRepositoryId: 123, installationId: 456 });
		expect((await getPair(f.bindings, repositoryName))?.enabled).toBe(0);
		expect(f.createBatch).not.toHaveBeenCalled();
		await enableGithub(f.bindings, { repositoryName, userId, enabled: true });
		expect((await getPair(f.bindings, repositoryName))?.subscriptionId).toBe("subscription");
		expect((await getPair(f.bindings, repositoryName))?.enabled).toBe(1);
		await enableGithub(f.bindings, { repositoryName, userId, enabled: false });
		expect(await syncGithub(f.bindings, repositoryName)).toEqual({ status: "disabled" });
		expect(f.mirror).not.toHaveBeenCalled();
	});
	it("pairs and enables through authenticated settings and real coordinator RPC, and serializes Workflow output", async () => {
		const f = fixture(),
			stub = env.REPOSITORIES.getByName(repositoryName);
		await runInDurableObject(stub, async (object) => {
			Object.assign(object, { env: f.bindings });
		});
		const cookie = await sessionCookie(),
			url = "http://localhost:8787/repos/sync-repo/sync";
		const request = (body: string) =>
			syncRoutes.request(
				url,
				{
					method: "POST",
					headers: {
						Origin: "http://localhost:8787",
						Cookie: cookie,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body,
				},
				f.bindings,
			);
		f.setPermissionId(999);
		expect((await request("action=pair&repositoryId=123&installationId=456")).status).toBe(403);
		f.setPermissionId(789);
		expect((await request("action=pair&repositoryId=123&installationId=456")).status).toBe(303);
		expect((await getPair(f.bindings, repositoryName))?.enabled).toBe(0);
		expect(f.createBatch).not.toHaveBeenCalled();
		expect((await request("action=enable")).status).toBe(303);
		const page = await syncRoutes.request(url, { headers: { Cookie: cookie } }, f.bindings);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("Enabled");
		const id = crypto.randomUUID();
		await using workflow = await introspectWorkflowInstance(env.GITHUB_SYNC, id);
		await env.GITHUB_SYNC.create({ id, params: { repositoryName } });
		await workflow.waitForStatus("complete");
		expect(await workflow.getOutput()).toEqual({ status: "synced" });
		expect(f.mirror).toHaveBeenCalled();
	});
	it("retains a write-ahead receipt after provider failure so uncertain new refs cannot be resurrected", async () => {
		const f = fixture();
		await seedPair();
		f.mirror.mockRejectedValueOnce(new Error("response lost"));
		await expect(syncGithub(f.bindings, repositoryName)).rejects.toThrow("response lost");
		expect(
			await env.DB.prepare("SELECT shared,status FROM sync_refs WHERE repositoryName=?")
				.bind(repositoryName)
				.first(),
		).toEqual({ shared: head, status: "pending" });
		await syncGithub(f.bindings, repositoryName);
		expect(f.mirror.mock.calls[1]).toEqual(expect.arrayContaining([{ "refs/heads/main": head }]));
	});
	it("runs actual coordinator sync through its shared FIFO and persists divergence without dropping baseline", async () => {
		const f = fixture();
		await seedPair();
		await runInDurableObject(env.REPOSITORIES.getByName(repositoryName), async (object) => {
			Object.assign(object, { env: f.bindings });
			expect(await object.syncGithub(repositoryName)).toEqual({ status: "synced" });
			f.mirror.mockResolvedValueOnce(
				Object.assign(
					[{ ref: "refs/heads/main", left: head, right: "b".repeat(40), status: "diverged", shared: null }],
					{ [Symbol.dispose]() {} },
				) as never,
			);
			expect(await object.syncGithub(repositoryName)).toEqual({ status: "conflict" });
		});
		const row = await env.DB.prepare("SELECT shared,status FROM sync_refs WHERE repositoryName=?")
			.bind(repositoryName)
			.first<{ shared: string; status: string }>();
		expect(row).toEqual({ shared: head, status: "diverged" });
		expect(f.revokeToken).toHaveBeenCalledTimes(2);
	});
	it("validates webhook HMAC over exact raw bytes before stable installation/repository lookup", async () => {
		const f = fixture();
		await seedPair();
		const body = JSON.stringify({ repository: { id: 123 }, installation: { id: 456 } }),
			sig = await signature(f.bindings.GITHUB_WEBHOOK_SECRET, body);
		expect(
			await webhookSignature(f.bindings.GITHUB_WEBHOOK_SECRET, sig, await new Blob([body]).arrayBuffer()),
		).toBe(true);
		const request = (value: string, signatureValue = sig) =>
			syncRoutes.request(
				"http://localhost:8787/webhooks/github",
				{
					method: "POST",
					headers: { "X-GitHub-Event": "push", "X-Hub-Signature-256": signatureValue },
					body: value,
				},
				f.bindings,
			);
		expect((await request(body + " ")).status).toBe(403);
		expect(f.createBatch).not.toHaveBeenCalled();
		expect((await request(body)).status).toBe(202);
		expect((await request(body)).status).toBe(202);
		expect(f.createBatch.mock.calls[0][0][0].id).toBe(f.createBatch.mock.calls[1][0][0].id);
		const wrong = JSON.stringify({ repository: { id: 123 }, installation: { id: 999 } });
		expect((await request(wrong, await signature(f.bindings.GITHUB_WEBHOOK_SECRET, wrong))).status).toBe(202);
		expect(f.createBatch).toHaveBeenCalledTimes(2);
		await env.DB.prepare("UPDATE github_pairs SET enabled=0").run();
		await request(body);
		expect(f.createBatch).toHaveBeenCalledTimes(2);
	});
	it("accepts only trusted Artifacts subscription events and polls notes-capable pairs", async () => {
		const f = fixture();
		await seedPair();
		const forged = event();
		forged.metadata.eventSubscriptionId = "forged";
		await dispatchArtifactsSync(f.bindings, forged);
		expect(f.createBatch).not.toHaveBeenCalled();
		await dispatchArtifactsSync(f.bindings, event());
		await dispatchArtifactsSync(f.bindings, event());
		expect(f.createBatch.mock.calls[0][0][0].id).toBe(f.createBatch.mock.calls[1][0][0].id);
		await pollSync(f.bindings);
		await pollSync(f.bindings);
		expect(f.createBatch).toHaveBeenCalledTimes(4);
		expect(f.createBatch.mock.calls[2][0][0].id).toBe(f.createBatch.mock.calls[3][0][0].id);
	});
	it("rejects unsigned hooks, anonymous settings and cross-origin mutations", async () => {
		const f = fixture();
		expect(
			(
				await syncRoutes.request(
					"http://localhost:8787/webhooks/github",
					{ method: "POST", body: "{}" },
					f.bindings,
				)
			).status,
		).toBe(403);
		expect((await syncRoutes.request("http://localhost:8787/repos/sync-repo/sync", {}, f.bindings)).status).toBe(
			401,
		);
		expect(
			(
				await syncRoutes.request(
					"http://localhost:8787/repos/sync-repo/sync",
					{ method: "POST", headers: { Origin: "https://attacker.test" }, body: "action=enable" },
					f.bindings,
				)
			).status,
		).toBe(403);
		expect(f.createBatch).not.toHaveBeenCalled();
	});
});
