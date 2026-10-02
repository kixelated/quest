// Trusted orchestration only: never check out or execute contributor code.
// The same argv-based engine runs in a Container and in local real-Git tests.
export interface GitResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}
export type GitExecutor = (
	argv: string[],
	options: { env: Record<string, string>; stdin?: string },
) => Promise<GitResult>;
export interface GitCapability {
	name: string;
	remote: string;
	token: string;
}
export interface GitAuthor {
	name: string;
	email: string;
}
export interface GitSnapshot {
	documents: { path: string; content: string }[];
	paths: string[];
}
export interface FileWrite {
	path: string;
	content: string | null;
}
export interface ReviewNote {
	version: 1;
	kind: "comment" | "approve" | "check";
	operationId: string;
	head: string;
	actor: { id: string; name: string };
	text: string;
	time: string;
	upstreamHead?: string;
	tree?: string;
	passed?: boolean;
}
export class GitConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GitConflict";
	}
}

export function assertSha(sha: string): void {
	if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid Git object ID");
}
export function assertQuestBranch(branch: string): void {
	if (!/^quest\/[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch) || branch.includes("..")) {
		throw new Error("Invalid quest branch");
	}
}
export function assertPath(path: string): void {
	if (
		!path ||
		path.startsWith("/") ||
		path.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") ||
		/[\x00-\x1f\x7f]/.test(path)
	)
		throw new Error("Invalid repository path");
}

export async function operationKey(value: string): Promise<string> {
	if (!value || value.length > 4096 || value.includes("\0")) throw new Error("Invalid operation ID");
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return "q1-" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class GitRepository {
	constructor(
		private readonly execute: GitExecutor,
		private readonly directory: string,
	) {}

	private async command(
		args: string[],
		options: { capability?: GitCapability; stdin?: string; author?: GitAuthor } = {},
		allowFailure = false,
	): Promise<GitResult> {
		const env: Record<string, string> = {
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
			GIT_CONFIG_COUNT: "0",
			GIT_INDEX_FILE: `${this.directory}/candidate-index`,
		};
		if (options.capability) {
			// Scope the ephemeral credential to this remote. Never store it in
			// a URL/config file or place it in command arguments/logs.
			env.GIT_CONFIG_COUNT = "1";
			env.GIT_CONFIG_KEY_0 = `http.${options.capability.remote}.extraHeader`;
			env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${options.capability.token}`;
		}
		if (options.author) {
			if (/[\n\r\x00<>]/.test(options.author.name + options.author.email)) {
				throw new Error("Invalid commit author");
			}
			env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = options.author.name;
			env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = options.author.email;
		}
		const result = await this.execute(
			[
				"git",
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"core.attributesFile=/dev/null",
				"-c",
				"protocol.ext.allow=never",
				"-c",
				"fetch.recurseSubmodules=false",
				"-c",
				"http.followRedirects=false",
				`--git-dir=${this.directory}`,
				...args,
			],
			{ env, stdin: options.stdin },
		);
		if (!allowFailure && result.exitCode !== 0) {
			// Git's transport diagnostics can contain credentials. Return a
			// fixed error, with no stderr or remote URL, across RPC/HTTP.
			throw new Error(`Git ${args[0]} failed (${result.exitCode})`);
		}
		return result;
	}

	async initialize(): Promise<void> {
		await this.command(["init", "--bare", this.directory]);
	}
	async head(remote: GitCapability, ref: string): Promise<string | null> {
		const result = await this.command(["ls-remote", "--refs", remote.remote, ref], { capability: remote });
		const head = result.stdout.trim().split(/\s/)[0];
		if (!head) return null;
		assertSha(head);
		return head;
	}
	async fetch(remote: GitCapability, ref: string, local: string): Promise<string | null> {
		const head = await this.head(remote, ref);
		if (!head) return null;
		await this.command(["fetch", "--no-tags", remote.remote, `${ref}:${local}`], { capability: remote });
		const fetched = (await this.command(["rev-parse", local])).stdout.trim();
		assertSha(fetched);
		return fetched;
	}
	async snapshot(tree: string): Promise<GitSnapshot> {
		assertSha(tree);
		const entries = (await this.command(["ls-tree", "-r", "-t", "-z", tree])).stdout.split("\0").filter(Boolean);
		if (entries.length > 100_000) throw new Error("Repository path limit exceeded");
		const snapshot: GitSnapshot = { documents: [], paths: [] };
		let size = 0;
		for (const entry of entries) {
			const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]*)$/.exec(entry);
			if (!match) throw new Error("Invalid Git tree entry");
			const [, mode, , object, path] = match;
			assertPath(path);
			snapshot.paths.push(path);
			if (!path.startsWith("quest/") || !path.endsWith(".md") || mode === "040000") continue;
			if (mode !== "100644" && mode !== "100755") throw new Error("Quest document must be a regular file");
			const length = Number((await this.command(["cat-file", "-s", object])).stdout.trim());
			size += length;
			if (length > 2_000_000 || size > 4_000_000) throw new Error("Quest snapshot size limit exceeded");
			const content = (await this.command(["cat-file", "blob", object])).stdout;
			snapshot.documents.push({ path, content });
		}
		return snapshot;
	}
	async writeTree(tree: string, files: FileWrite[]): Promise<string> {
		assertSha(tree);
		await this.command(["read-tree", tree]);
		for (const file of files) {
			assertPath(file.path);
			if (file.content === null) {
				await this.command(["update-index", "-z", "--index-info"], {
					stdin: `0 ${"0".repeat(40)}\t${file.path}\0`,
				});
			} else {
				if (file.content.length > 2_000_000) throw new Error("File size limit exceeded");
				const blob = (
					await this.command(["hash-object", "-w", "--stdin"], { stdin: file.content })
				).stdout.trim();
				await this.command(["update-index", "--add", "--cacheinfo", "100644", blob, file.path]);
			}
		}
		return (await this.command(["write-tree"])).stdout.trim();
	}
	async inspect(upstream: GitCapability, fork: GitCapability, branch: string, expectedHead: string) {
		assertQuestBranch(branch);
		assertSha(expectedHead);
		const upstreamHead = await this.fetch(upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const forkHead = await this.fetch(fork, `refs/heads/${branch}`, "refs/remotes/fork/change");
		if (!upstreamHead || forkHead !== expectedHead) throw new GitConflict("Change head moved");
		const diff = (await this.command(["diff", "--no-ext-diff", "--no-textconv", "--stat", upstreamHead, forkHead]))
			.stdout;
		const patch = (
			await this.command([
				"diff",
				"--no-ext-diff",
				"--no-textconv",
				"--no-renames",
				`${upstreamHead}...${forkHead}`,
			])
		).stdout;
		if (patch.length > 2_000_000) throw new Error("Diff size limit exceeded");
		const merged = await this.command(["merge-tree", "--write-tree", upstreamHead, forkHead], {}, true);
		if (merged.exitCode !== 0)
			return { upstreamHead, forkHead, diff, patch, conflicts: merged.stdout, tree: null, snapshot: null };
		const tree = merged.stdout.trim().split("\n")[0];
		assertSha(tree);
		return {
			upstreamHead,
			forkHead,
			diff,
			patch,
			conflicts: null,
			tree,
			snapshot: await this.snapshot(tree),
			upstreamSnapshot: await this.snapshot(upstreamHead),
		};
	}
	async notes(upstream: GitCapability, head: string): Promise<ReviewNote[]> {
		assertSha(head);
		await this.fetch(upstream, "refs/notes/quest", "refs/notes/quest");
		const result = await this.command(["notes", "--ref=quest", "show", head], {}, true);
		if (result.exitCode !== 0) return [];
		const notes = JSON.parse(result.stdout) as ReviewNote[];
		if (!Array.isArray(notes)) throw new Error("Invalid review notes");
		return notes;
	}
	async appendNote(upstream: GitCapability, note: ReviewNote, author: GitAuthor): Promise<string> {
		note = { ...note, operationId: await operationKey(note.operationId) };
		const existing = await this.notes(upstream, note.head);
		if (existing.some((item) => item.operationId === note.operationId)) {
			return (await this.command(["rev-parse", "refs/notes/quest"])).stdout.trim();
		}
		if (existing.length >= 500 || note.text.length > 20_000) throw new Error("Review note limit exceeded");
		await this.command(["notes", "--ref=quest", "add", "-f", "-F", "-", note.head], {
			stdin: JSON.stringify([...existing, note]),
			author,
		});
		const commit = (await this.command(["rev-parse", "refs/notes/quest"])).stdout.trim();
		await this.command(["push", upstream.remote, `${commit}:refs/notes/quest`], { capability: upstream });
		return commit;
	}
	private async commitAndPush(
		upstream: GitCapability,
		tree: string,
		parents: string[],
		author: GitAuthor,
		operationId: string,
	): Promise<string> {
		assertSha(tree);
		parents.forEach(assertSha);
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) throw new Error("Invalid operation ID");
		if ((await this.head(upstream, "refs/heads/main")) !== parents[0]) throw new GitConflict("Upstream head moved");
		const commit = (
			await this.command(["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], {
				author,
				stdin: `Apply Quest change\n\nQuest-Operation: ${operationId}\n`,
			})
		).stdout.trim();
		const pushed = await this.command(
			["push", upstream.remote, `${commit}:refs/heads/main`],
			{ capability: upstream },
			true,
		);
		if (pushed.exitCode !== 0) throw new GitConflict("Upstream push rejected; refresh the change");
		return commit;
	}
	private async recover(expectedHead: string, tree: string, operationId: string): Promise<string | null> {
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) throw new Error("Invalid operation ID");
		const log = await this.command([
			"log",
			"refs/remotes/upstream/main",
			"--format=%H%x00%P%x00%T%x00%B%x00",
			"--fixed-strings",
			`--grep=Quest-Operation: ${operationId}`,
		]);
		const fields = log.stdout.split("\0");
		for (let index = 0; index + 3 < fields.length; index += 4) {
			const [commit, parents, committedTree, body] = fields.slice(index, index + 4);
			if (
				parents.split(" ")[0] === expectedHead &&
				committedTree === tree &&
				body.split("\n").includes(`Quest-Operation: ${operationId}`)
			) {
				return commit.trim();
			}
		}
		return null;
	}
	async recoverMutation(upstream: GitCapability, expectedHead: string, tree: string, operationId: string) {
		assertSha(expectedHead);
		assertSha(tree);
		await this.fetch(upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const commitSha = await this.recover(expectedHead, tree, await operationKey(operationId));
		return commitSha ? { commitSha } : null;
	}

	async applyMutation(
		upstream: GitCapability,
		expectedHead: string,
		operationId: string,
		files: FileWrite[],
		author: GitAuthor,
	) {
		operationId = await operationKey(operationId);
		assertSha(expectedHead);
		const head = await this.fetch(upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const tree = await this.writeTree(expectedHead, files);
		const recovered = await this.recover(expectedHead, tree, operationId);
		if (recovered) return { commitSha: recovered };
		if (head !== expectedHead) throw new GitConflict("Upstream head moved");
		return { commitSha: await this.commitAndPush(upstream, tree, [expectedHead], author, operationId) };
	}
	async merge(
		upstream: GitCapability,
		fork: GitCapability,
		branch: string,
		expectedHead: string,
		expectedForkHead: string,
		expectedTree: string,
		cleanup: FileWrite[],
		author: GitAuthor,
		operationId: string,
	) {
		operationId = await operationKey(operationId);
		await this.fetch(upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const recovered = await this.recover(expectedHead, expectedTree, operationId);
		if (recovered) return { commitSha: recovered };
		const candidate = await this.inspect(upstream, fork, branch, expectedForkHead);
		if (candidate.upstreamHead !== expectedHead || !candidate.tree)
			throw new GitConflict("Merge base changed or conflicts exist");
		const tree = await this.writeTree(candidate.tree, cleanup);
		if (tree !== expectedTree) throw new GitConflict("Checked tree changed");
		if ((await this.head(fork, `refs/heads/${branch}`)) !== expectedForkHead)
			throw new GitConflict("Change head moved");
		return {
			commitSha: await this.commitAndPush(upstream, tree, [expectedHead, expectedForkHead], author, operationId),
		};
	}
}
