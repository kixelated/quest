import { DurableObject } from "cloudflare:workers";
import { GitRepository, type GitCapability, type GitAuthor, type FileWrite, type ReviewNote } from "./git";

// This container only runs fixed Git argv. It never runs repository scripts,
// hooks, build commands, or an agent, and each operation gets a fresh bare repo.
export class GitSandbox extends DurableObject<Env> {
	private tail: Promise<unknown> = Promise.resolve();
	private async use<T>(operation: (git: GitRepository) => Promise<T>): Promise<T> {
		const run = async () => {
			const container = this.ctx.container;
			if (!container) throw new Error("Git container is not configured");
			if (!container.running) {
				container.start({ image: container.images.git, enableInternet: true });
			}
			await container.setInactivityTimeout(60_000);
			const directory = `/tmp/quest-${crypto.randomUUID()}`;
			const git = new GitRepository(async (argv, options) => {
				const stdin = options.stdin === undefined ? undefined : new Blob([options.stdin]).stream();
				const process = await container.exec(["timeout", "--kill-after=5", "60", ...argv], {
					env: options.env,
					stdin,
				});
				const read = async (stream: ReadableStream | null, limit: number) => {
					if (!stream) return "";
					const reader = stream.getReader();
					const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
					let text = "",
						size = 0;
					try {
						while (true) {
							const result = await reader.read();
							if (result.done) break;
							size += result.value.byteLength;
							if (size > limit) {
								await container.destroy();
								throw new Error("Git output limit exceeded");
							}
							text += decoder.decode(result.value, { stream: true });
						}
						return text + decoder.decode();
					} finally {
						reader.releaseLock();
					}
				};
				const [stdout, stderr, exitCode] = await Promise.all([
					read(process.stdout, 8_000_000),
					read(process.stderr, 1_000_000),
					process.exitCode,
				]);
				return { exitCode, stdout, stderr };
			}, directory);
			try {
				await git.initialize();
				return await operation(git);
			} finally {
				if (container.running) {
					const process = await container.exec(["rm", "-rf", "--", directory]);
					await process.output();
				}
			}
		};
		const result = this.tail.then(run, run);
		this.tail = result.catch(() => {});
		return result;
	}
	inspect(upstream: GitCapability, fork: GitCapability, branch: string, head: string) {
		return this.use((git) => git.inspect(upstream, fork, branch, head));
	}
	head(remote: GitCapability, ref: string) {
		return this.use((git) => git.head(remote, ref));
	}
	snapshot(upstream: GitCapability, ref: string) {
		return this.use(async (git) => {
			const head = await git.fetch(upstream, ref, "refs/remotes/upstream/snapshot");
			if (!head) throw new Error("Missing Git ref");
			return { head, snapshot: await git.snapshot(head) };
		});
	}
	prepare(upstream: GitCapability, fork: GitCapability, branch: string, head: string, cleanup: FileWrite[]) {
		return this.use(async (git) => {
			const candidate = await git.inspect(upstream, fork, branch, head);
			if (!candidate.tree) return candidate;
			const tree = await git.writeTree(candidate.tree, cleanup);
			return { ...candidate, tree, snapshot: await git.snapshot(tree) };
		});
	}
	notes(upstream: GitCapability, fork: GitCapability, branch: string, head: string) {
		return this.use(async (git) => {
			await git.inspect(upstream, fork, branch, head);
			return git.notes(upstream, head);
		});
	}
	appendNote(upstream: GitCapability, fork: GitCapability, branch: string, note: ReviewNote, author: GitAuthor) {
		return this.use(async (git) => {
			await git.inspect(upstream, fork, branch, note.head);
			return git.appendNote(upstream, note, author);
		});
	}
	applyMutation(
		upstream: GitCapability,
		request: { expectedHead: string; operationId: string; files: FileWrite[]; author: GitAuthor },
	) {
		return this.use((git) =>
			git.applyMutation(upstream, request.expectedHead, request.operationId, request.files, request.author),
		);
	}
	recoverMutation(upstream: GitCapability, expectedHead: string, tree: string, operationId: string) {
		return this.use((git) => git.recoverMutation(upstream, expectedHead, tree, operationId));
	}

	merge(
		upstream: GitCapability,
		fork: GitCapability,
		request: {
			branch: string;
			expectedHead: string;
			expectedForkHead: string;
			expectedTree: string;
			cleanup: FileWrite[];
			author: GitAuthor;
			operationId: string;
		},
	) {
		return this.use((git) =>
			git.merge(
				upstream,
				fork,
				request.branch,
				request.expectedHead,
				request.expectedForkHead,
				request.expectedTree,
				request.cleanup,
				request.author,
				request.operationId,
			),
		);
	}
}
