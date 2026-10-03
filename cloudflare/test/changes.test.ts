import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryCoordinator } from "../src/repository";
import { changesRoutes } from "../src/changes/routes";
import { dispatchChangePush } from "../src/changes/workflow";
import { writeFiles, type ChangeIdentity } from "../src/mutations";
import { GitConflict } from "../src/git";
import type { ReviewNote } from "../src/git";
import type { Fork } from "../src/intake/registry";
import type { PushEvent } from "../src/intake/events";

const main = "a".repeat(40),
	head = "b".repeat(40),
	tree = "c".repeat(40),
	mergedHead = "d".repeat(40);
const identity: ChangeIdentity = {
	repositoryName: "changes-repo",
	forkName: "changes-fork",
	branch: "quest/new",
	head,
};
const fork: Fork = {
	forkName: identity.forkName,
	repositoryName: identity.repositoryName,
	remote: "https://git.test/fork",
	userId: "contributor",
	provider: "github",
	identity: "2",
	name: "Contributor",
	email: "private@example.test",
	lastPushAt: 0,
	subscriptionId: "subscription",
};
const upstreamSnapshot = {
	paths: ["quest", "quest/README.md"],
	documents: [{ path: "quest/README.md", content: "# Quests\n\n## Goal\n\nRoadmap.\n" }],
};
const snapshot = {
	paths: ["quest", "quest/README.md", "quest/new.md"],
	documents: [
		{
			path: "quest/README.md",
			content: "# Quests\n\n## Goal\n\nRoadmap.\n\n## Required\n\n- [New](/quest/new.md)\n",
		},
		{ path: "quest/new.md", content: "# [S] New\n\n## Goal\n\nA proposal.\n" },
	],
};
function fixture() {
	let merged = false,
		forkHead = head,
		landed: string | null = null,
		loseResponse = false;
	const notes: ReviewNote[] = [];
	const git = {
		head: vi.fn(async (capability: { name: string }) =>
			capability.name === fork.forkName ? forkHead : merged ? mergedHead : main,
		),
		inspect: vi.fn(async () => ({
			[Symbol.dispose]() {},
			upstreamHead: merged ? mergedHead : main,
			forkHead,
			merged,
			diff: "one file",
			patch: "<script>unsafe</script>",
			conflicts: null,
			tree: merged ? null : tree,
			snapshot: merged ? null : snapshot,
			upstreamSnapshot: merged ? null : upstreamSnapshot,
		})),
		notes: vi.fn(async () => notes),
		recoverNote: vi.fn(
			async (_capability: unknown, _head: string, operationId: string, kind: string, actorId: string) =>
				notes.some(
					(note) => note.operationId === operationId && note.kind === kind && note.actor.id === actorId,
				)
					? "e".repeat(40)
					: null,
		),
		appendNote: vi.fn(async (_upstream: unknown, _fork: unknown, _branch: string, note: ReviewNote) => {
			notes.push(note);
			return "e".repeat(40);
		}),
		recoverMutation: vi.fn(async (_capability: unknown, _base: string, _tree: string, operationId: string) =>
			landed === operationId ? { commitSha: mergedHead } : null,
		),
		merge: vi.fn(async (_upstream: unknown, _fork: unknown, request: { operationId: string }) => {
			merged = true;
			landed = request.operationId;
			if (loseResponse) throw new Error("Response lost after push");
			return { commitSha: mergedHead };
		}),
	};
	const artifacts = {
		get: async (name: string) => ({
			[Symbol.dispose]() {},
			info: async () => ({ remote: name === fork.forkName ? fork.remote : "https://git.test/upstream" }),
			createToken: async () => ({ plaintext: "test", id: "token" }),
			revokeToken: vi.fn(async () => {}),
		}),
	};
	const createBatch = vi.fn(async (items: { id: string }[]) => items);
	const bindings = {
		...env,
		GIT: { getByName: () => git },
		ARTIFACTS: artifacts,
		EVENT_ACCOUNT_ID: "account",
		ARTIFACTS_NAMESPACE: "namespace",
		CHANGE_CHECKS: { createBatch },
	} as unknown as Env;
	return {
		bindings,
		git,
		createBatch,
		setMerged(value: boolean) {
			merged = value;
		},
		setForkHead(value: string) {
			forkHead = value;
		},
		loseResponse() {
			loseResponse = true;
		},
	};
}
async function cache(headValue = head) {
	await env.DB.prepare("INSERT OR REPLACE INTO changes VALUES(?,?,?,?,?)")
		.bind(identity.repositoryName, identity.forkName, identity.branch, headValue, 0)
		.run();
}
async function count() {
	return (await env.DB.prepare("SELECT count(*) AS count FROM changes").first<{ count: number }>())!.count;
}
async function sessionCookie() {
	const token = "changes-session";
	await env.DB.prepare(
		"INSERT OR REPLACE INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
	)
		.bind("changes-session", Date.now() + 3600000, token, Date.now(), Date.now(), "maintainer")
		.run();
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.AUTH_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = btoa(
		String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)))),
	);
	return "better-auth.session_token=" + encodeURIComponent(token + "." + signature);
}
function event(after = head): PushEvent {
	return {
		type: "cf.artifacts.repo.pushed",
		source: { type: "artifacts.repo", namespace: "namespace", repoName: fork.forkName },
		payload: { ref: "refs/heads/quest/new", before: main, after },
		metadata: {
			accountId: "account",
			eventSubscriptionId: "subscription",
			eventTimestamp: new Date().toISOString(),
			eventSchemaVersion: 1,
		},
	};
}
beforeEach(async () => {
	vi.clearAllMocks();
	await env.DB.prepare("DELETE FROM changes").run();
	await env.DB.batch([
		env.DB.prepare(
			"INSERT OR IGNORE INTO user(id,name,email,createdAt,updatedAt) VALUES('maintainer','Maintainer <team>','private-maintainer@example.test',0,0),('contributor','Contributor','private-contributor@example.test',0,0)",
		),
		env.DB.prepare(
			"INSERT OR IGNORE INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('owner','1','github','maintainer',0,0),('contributor-account','2','github','contributor',0,0)",
		),
		env.DB.prepare("INSERT OR IGNORE INTO repositories VALUES(?,?,?,?,?)").bind(
			identity.repositoryName,
			"https://git.test/upstream",
			"main",
			"maintainer",
			0,
		),
		env.DB.prepare("INSERT OR REPLACE INTO forks VALUES(?,?,?,?,?,?,?,?,?,?)").bind(
			fork.forkName,
			fork.repositoryName,
			fork.userId,
			fork.remote,
			fork.subscriptionId,
			fork.provider,
			fork.identity,
			fork.name,
			fork.email,
			0,
		),
	]);
});
describe("checked change lifecycle", () => {
	it("checks, approves and merges a new quest proposal through the coordinator", async () => {
		const f = fixture();
		await cache();
		await runInDurableObject(env.REPOSITORIES.getByName(identity.repositoryName), async (_object, state) => {
			const coordinator = new RepositoryCoordinator(state, f.bindings);
			await coordinator.checkChange({ ...identity, operationId: "check-new" });
			await coordinator.mutate({
				...identity,
				userId: "maintainer",
				kind: "approve",
				operationId: "approve-new",
				checkedTree: tree,
				expectedHead: main,
			});
			expect(f.git.merge).not.toHaveBeenCalled();
			expect(
				await coordinator.mutate({
					...identity,
					userId: "maintainer",
					kind: "merge",
					operationId: "merge-new",
					checkedTree: tree,
					expectedHead: main,
				}),
			).toEqual({ commitSha: mergedHead });
		});
		expect(await count()).toBe(0);
	});
	it("recovers a landed merge before stale check preflight after a lost response", async () => {
		const f = fixture();
		await cache();
		f.loseResponse();
		const request = {
			...identity,
			userId: "maintainer",
			kind: "merge" as const,
			operationId: "merge-recovery",
			checkedTree: tree,
			expectedHead: main,
		};
		await runInDurableObject(env.REPOSITORIES.getByName(identity.repositoryName), async (_object, state) => {
			const coordinator = new RepositoryCoordinator(state, f.bindings);
			await coordinator.checkChange({ ...identity, operationId: "check-recovery" });
			await coordinator.mutate({ ...request, kind: "approve", operationId: "approve-recovery" });
			await expect(coordinator.mutate(request)).rejects.toThrow("Response lost");
			f.git.inspect.mockClear();
			const restarted = new RepositoryCoordinator(state, f.bindings);
			expect(await restarted.mutate(request)).toEqual({ commitSha: mergedHead });
			expect(f.git.inspect).not.toHaveBeenCalled();
		});
		expect(await count()).toBe(0);
		expect(f.git.merge).toHaveBeenCalledTimes(1);
	});
	it("recovers a landed comment after the fork head moves", async () => {
		const f = fixture();
		await runInDurableObject(env.REPOSITORIES.getByName(identity.repositoryName), async (_object, state) => {
			const coordinator = new RepositoryCoordinator(state, f.bindings);
			const request = {
				...identity,
				userId: "contributor",
				kind: "comment" as const,
				operationId: "comment-retry",
				text: "Review",
			};
			f.git.appendNote.mockImplementationOnce(async (_u, _f, _b, note) => {
				(await f.git.notes()).push(note);
				throw new Error("Note response lost");
			});
			await expect(coordinator.mutate(request)).rejects.toThrow("Note response lost");
			f.git.inspect.mockRejectedValueOnce(new Error("Fork moved"));
			expect(await coordinator.mutate(request)).toEqual({ notesCommit: "e".repeat(40) });
			expect(f.git.inspect).toHaveBeenCalledTimes(1);
		});
	});
	it("rejects stale checked trees and contributor approvals", async () => {
		const f = fixture();
		await runInDurableObject(env.REPOSITORIES.getByName(identity.repositoryName), async (_object, state) => {
			const coordinator = new RepositoryCoordinator(state, f.bindings);
			await coordinator.checkChange({ ...identity, operationId: "check-stale" });
			await expect(
				coordinator.mutate({
					...identity,
					userId: "maintainer",
					kind: "approve",
					operationId: "stale",
					checkedTree: "f".repeat(40),
					expectedHead: main,
				}),
			).rejects.toThrow("Current head");
			await expect(
				coordinator.mutate({
					...identity,
					userId: "contributor",
					kind: "approve",
					operationId: "forged",
					checkedTree: tree,
					expectedHead: main,
				}),
			).rejects.toThrow("Mutation not authorized");
		});
		expect(f.git.merge).not.toHaveBeenCalled();
	});
	it("renders a closed change without actions and escapes untrusted diffs", async () => {
		const f = fixture();
		await cache();
		const url = `http://localhost:8787/repos/${identity.repositoryName}/changes/${identity.forkName}?branch=${identity.branch}&head=${head}`;
		const open = await changesRoutes.request(url, { headers: { Cookie: await sessionCookie() } }, f.bindings);
		expect(open.status).toBe(200);
		expect(await open.text()).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
		f.setMerged(true);
		const closed = await changesRoutes.request(url, { headers: { Cookie: await sessionCookie() } }, f.bindings);
		const html = await closed.text();
		expect(html).toContain("already part of upstream");
		expect(html).not.toContain("<form");
		expect(await count()).toBe(0);
	});
	it("does not reopen retained merged branches on duplicate pushes, but accepts newer heads", async () => {
		const f = fixture();
		await cache();
		f.setMerged(true);
		await dispatchChangePush(f.bindings, event(), fork);
		expect(await count()).toBe(0);
		expect(f.createBatch).not.toHaveBeenCalled();
		f.setMerged(false);
		const newer = "f".repeat(40);
		f.setForkHead(newer);
		await dispatchChangePush(f.bindings, event(newer), fork);
		expect(await count()).toBe(1);
		expect(f.createBatch).toHaveBeenCalledTimes(1);
		await dispatchChangePush(f.bindings, event(), fork);
		expect((await env.DB.prepare("SELECT head FROM changes").first<{ head: string }>())!.head).toBe(newer);
	});
	it("preserves confirmed conflicts across the actual Git RPC boundary", async () => {
		const f = fixture(),
			stub = env.GIT.getByName("rpc-conflict");
		await runInDurableObject(stub, (object) => {
			Object.assign(object, {
				use: async (operation: (git: unknown) => Promise<unknown>) =>
					operation({
						applyMutation: async () => {
							throw new GitConflict("Upstream head moved");
						},
					}),
			});
		});
		const request = {
			expectedHead: main,
			operationId: "rpc:conflict",
			files: [],
			author: { name: "Quest", email: "quest@localhost" },
		};
		using result = await stub.applyMutation(
			{ name: "changes-repo", remote: "https://git.test/upstream", token: "test" },
			request,
		);
		expect(result).toEqual({ conflict: "Upstream head moved" });
		const bindings = { ...f.bindings, GIT: { getByName: () => stub } } as unknown as Env;
		await expect(
			writeFiles(
				bindings,
				{
					name: identity.repositoryName,
					remote: "https://git.test/upstream",
					defaultBranch: "main",
					maintainerId: "maintainer",
				},
				request,
			),
		).rejects.toBeInstanceOf(GitConflict);
	});
	it.each([403, 409] as const)("preserves HTTP %s from an actual coordinator RPC rejection", async (status) => {
		const f = fixture(),
			stub = env.REPOSITORIES.getByName(`http-rpc-${status}`);
		await runInDurableObject(stub, (object, state) => {
			if (status === 409) {
				state.storage.sql.exec("INSERT OR REPLACE INTO repository_name VALUES(1,?)", "different-repository");
			} else {
				const db = {
					prepare: (query: string) => ({
						bind() {
							return this;
						},
						first: async () =>
							query.includes("FROM repositories")
								? {
										name: identity.repositoryName,
										remote: "https://git.test/upstream",
										defaultBranch: "main",
										maintainerId: "different-maintainer",
									}
								: { ...fork, userId: "different-contributor" },
					}),
				};
				Object.assign(object, { env: { ...f.bindings, DB: db } });
			}
		});
		const bindings = { ...f.bindings, REPOSITORIES: { getByName: () => stub } } as unknown as Env;
		const response = await changesRoutes.request(
			"http://localhost:8787/repos/changes-repo/changes/changes-fork/comment",
			{
				method: "POST",
				headers: {
					Origin: "http://localhost:8787",
					Cookie: await sessionCookie(),
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					branch: identity.branch,
					head: identity.head,
					operationId: "http-rpc",
					text: "Review",
				}),
			},
			bindings,
		);
		expect(response.status).toBe(status);
		expect(await response.text()).toContain(
			status === 403 ? "Mutation not authorized" : "Coordinator repository mismatch",
		);
	});
	it("requires trusted push subscriptions and rejects anonymous/cross-origin routes", async () => {
		const f = fixture();
		const forged = event();
		forged.metadata.eventSubscriptionId = "attacker";
		await dispatchChangePush(f.bindings, forged, fork);
		expect(f.git.head).not.toHaveBeenCalled();

		expect(
			(await changesRoutes.request("http://localhost:8787/repos/changes-repo/changes", {}, f.bindings)).status,
		).toBe(401);
		expect(
			(
				await changesRoutes.request(
					"http://localhost:8787/repos/changes-repo/changes/changes-fork/merge",
					{ method: "POST", headers: { Origin: "https://attacker.test" } },
					f.bindings,
				)
			).status,
		).toBe(403);
	});
});
