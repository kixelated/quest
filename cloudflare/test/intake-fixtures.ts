import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { GitConflict } from "../src/git";
import type { FileChange } from "../src/intake/gate";
import type { PushEvent } from "../src/intake/events";
import type { Actor, Fork } from "../src/intake/registry";

export const original = "# [S] One\n\n## Goal\n\nShip one.\n";
export const rootDoc = "# Quests\n\n## Goal\n\nWork.\n\n## Required\n\n- [One](/quest/one.md)\n";
export const owner: Actor = {
	userId: "maintainer",
	provider: "github",
	identity: "1",
	name: "Maintainer",
	email: "maintainer@example.com",
};
export const contributor: Fork = {
	userId: "contributor",
	provider: "github",
	identity: "1234",
	name: "Contributor (team)",
	email: "contributor@example.com",
	forkName: "fork-one",
	repositoryName: "upstream",
	remote: "https://artifacts.example/fork-one.git",
	lastPushAt: Date.now(),
	subscriptionId: "subscription",
};
export function claimed(fork = contributor): string {
	return (
		original +
		`\n## Claim\n\n- ${fork.name} (${fork.provider}:${fork.identity}) on ${fork.remote} since 2026-10-02\n`
	);
}
export type Files = Record<string, string | Uint8Array>;
export const base = "b".repeat(40),
	pushed = "c".repeat(40);

// A local immutable Artifacts object store. The production snapshot reader
// and actual wasm evaluator consume this fixture through their real APIs.
export class FixtureRepo {
	head = base;
	lastPushAt = Date.now();
	blobs = new Map<string, string | Uint8Array>();
	commits = new Map<string, { files: Files; parents: string[] }>();
	constructor(
		public name: string,
		files: Files = { "quest/README.md": rootDoc, "quest/one.md": original },
	) {
		this.add(base, files, []);
	}
	add(hash: string, files: Files, parents = [this.head]) {
		this.commits.set(hash, { files, parents });
		this.head = hash;
	}
	[Symbol.dispose]() {}
	async info() {
		return {
			id: this.name,
			name: this.name,
			remote: `https://artifacts.example/${this.name}.git`,
			defaultBranch: "main",
			readOnly: false,
			lastPushAt: new Date(this.lastPushAt).toISOString(),
			createdAt: new Date(this.lastPushAt).toISOString(),
			updatedAt: new Date(this.lastPushAt).toISOString(),
			description: null,
			source: this.name === "upstream" ? null : "artifacts:quest/upstream",
		};
	}
	async readCommit(hash: string) {
		const data = this.commits.get(hash);
		return data
			? {
					hash,
					treeHash: `${hash}:`,
					message: "Ignored untrusted author",
					author: { name: "Forged", email: "forged@example.com" },
					committer: { name: "Forged", email: "forged@example.com" },
					parents: data.parents,
					authoredAt: 0,
					committedAt: 0,
				}
			: null;
	}
	async log({ ref = "refs/heads/main", limit = 50 }: { ref?: string; limit?: number } = {}) {
		let hash = ref.startsWith("refs/") ? this.head : ref;
		const result = [];
		while (result.length < limit) {
			const commit = await this.readCommit(hash);
			if (!commit) break;
			result.push(commit);
			hash = commit.parents[0];
		}
		return result;
	}
	async readTree(hash: string): Promise<ArtifactsTreeEntry[] | null> {
		const [commit, prefix] = hash.split(":"),
			data = this.commits.get(commit);
		if (!data) return null;
		const entries = new Map<string, ArtifactsTreeEntry>();
		for (const path of Object.keys(data.files)) {
			if (!path.startsWith(prefix)) continue;
			const rest = path.slice(prefix.length),
				name = rest.split("/")[0],
				isTree = rest.includes("/");
			const content = data.files[path];
			const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
			const blobHash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
			this.blobs.set(blobHash, content);
			entries.set(name, {
				name,
				type: isTree ? "tree" : "blob",
				mode: isTree ? "40000" : "100644",
				hash: isTree ? `${commit}:${prefix}${name}/` : blobHash,
			});
		}
		return [...entries.values()];
	}
	async readBlob(hash: string) {
		const [commit, path] = hash.split(":"),
			content = this.blobs.get(hash) ?? this.commits.get(commit)?.files[path];
		return content === undefined ? null : new Blob([content]);
	}
	async readFile({ ref, path }: { ref: string; path: string }) {
		return this.readBlob(`${ref}:${path}`);
	}
	createToken = vi.fn(async () => ({
		id: crypto.randomUUID(),
		plaintext: "fixture-token",
		scope: "write",
		expiresAt: new Date(Date.now() + 300000).toISOString(),
	}));
	revokeToken = vi.fn(async () => true);
	listTokens = vi.fn(async () => ({ total: 0, tokens: [] }));
}

export function event(fork = contributor, before = base, after = pushed): PushEvent {
	return {
		type: "cf.artifacts.repo.pushed",
		source: { type: "artifacts.repo", namespace: "quest", repoName: fork.forkName },
		payload: { ref: "refs/heads/main", before, after },
		metadata: {
			accountId: "a".repeat(32),
			eventSubscriptionId: fork.subscriptionId!,
			eventSchemaVersion: 1,
			eventTimestamp: new Date().toISOString(),
		},
	};
}

export function services() {
	const upstream = new FixtureRepo("upstream"),
		source = new FixtureRepo(contributor.forkName);
	source.add(pushed, { ...source.commits.get(base)!.files, "quest/one.md": claimed() });
	const repos = new Map([
		["upstream", upstream],
		[source.name, source],
	]);
	const landed = new Map<string, string>();
	let counter = 100,
		lost = false,
		fail = false;
	const applyMutation = vi.fn(
		async (
			_cap: unknown,
			request: { expectedHead: string; operationId: string; files: FileChange[]; author: Actor },
		) => {
			await Promise.resolve(); // Force external-I/O interleaving in concurrency tests.
			const known = landed.get(request.operationId);
			if (known) return { commitSha: known };
			if (upstream.head !== request.expectedHead) throw new GitConflict("Upstream advanced");
			if (fail) {
				fail = false;
				throw new Error("Failed before push");
			}
			const files = { ...upstream.commits.get(upstream.head)!.files };
			for (const file of request.files) {
				if (file.content === null) delete files[file.path];
				else files[file.path] = file.content;
			}
			const commitSha = (counter++).toString(16).padStart(40, "0");
			upstream.add(commitSha, files);
			landed.set(request.operationId, commitSha);
			if (lost) {
				lost = false;
				throw new Error("Response lost after successful push");
			}
			return { commitSha };
		},
	);
	const mockEnv = {
		...env,
		ARTIFACTS: {
			get: vi.fn(async (name: string) => {
				const repo = repos.get(name);
				if (!repo) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
				return repo;
			}),
		},
		GIT: { getByName: () => ({ applyMutation }) },
		AUTH_MAINTAINERS: "github:1",
		EVENT_ACCOUNT_ID: "a".repeat(32),
		EVENT_QUEUE_ID: "d".repeat(32),
		EVENT_SUBSCRIPTION_TOKEN: "fake-subscription-token",
	} as unknown as Env;
	return {
		upstream,
		source,
		repos,
		mockEnv,
		applyMutation,
		loseResponse: () => {
			lost = true;
		},
		failBeforePush: () => {
			fail = true;
		},
	};
}

export async function seed(forks: Fork[] = [contributor]) {
	for (const actor of [owner, ...forks]) {
		await env.DB.prepare(
			"INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)",
		)
			.bind(actor.userId, actor.name, actor.email, Date.now(), Date.now())
			.run();
	}
	await env.DB.prepare("INSERT OR IGNORE INTO repositories VALUES(?,?,?,?,?)")
		.bind("upstream", "https://artifacts.example/upstream.git", "main", owner.userId, Date.now())
		.run();
	for (const fork of forks)
		await env.DB.prepare(
			"INSERT OR REPLACE INTO forks(forkName,repositoryName,userId,remote,provider,identity,name,email,lastPushAt,subscriptionId) VALUES(?,?,?,?,?,?,?,?,?,?)",
		)
			.bind(
				fork.forkName,
				fork.repositoryName,
				fork.userId,
				fork.remote,
				fork.provider,
				fork.identity,
				fork.name,
				fork.email,
				Date.now(),
				fork.subscriptionId,
			)
			.run();
}
