import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepository, operationKey, type GitCapability, type GitExecutor } from "../src/git";

const author = { name: "Trusted Maintainer", email: "maintainer@example.test" };
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const execute: GitExecutor = (argv, options) =>
	new Promise((resolve, reject) => {
		const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...options.env }, stdio: "pipe" });
		let stdout = "",
			stderr = "";
		child.stdout.setEncoding("utf8").on("data", (value) => {
			stdout += value;
		});
		child.stderr.setEncoding("utf8").on("data", (value) => {
			stderr += value;
		});
		child.on("error", reject);
		child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
		child.stdin.end(options.stdin);
	});
async function run(cwd: string, ...args: string[]) {
	const result = await execute(["git", "-C", cwd, ...args], {
		env: {
			GIT_AUTHOR_NAME: author.name,
			GIT_AUTHOR_EMAIL: author.email,
			GIT_COMMITTER_NAME: author.name,
			GIT_COMMITTER_EMAIL: author.email,
		},
	});
	if (result.exitCode) throw new Error(result.stderr);
	return result.stdout.trim();
}
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "quest-real-git-"));
	directories.push(directory);
	const source = join(directory, "source"),
		upstreamPath = join(directory, "upstream.git"),
		forkPath = join(directory, "fork.git");
	await mkdir(join(source, "quest"), { recursive: true });
	await mkdir(join(source, "docs"));
	await writeFile(join(source, "quest", "task.md"), "# [S] Task\n\n## Goal\n\nSee [docs](/docs).\n");
	await writeFile(join(source, "docs", "readme.txt"), "Documentation\n");
	await run(source, "init", "-b", "main");
	await run(source, "add", ".");
	await run(source, "commit", "-m", "Initial");
	await run(source, "clone", "--bare", source, upstreamPath);
	await run(source, "clone", "--bare", source, forkPath);
	const upstream: GitCapability = { name: "upstream", remote: upstreamPath, token: "test" };
	const fork: GitCapability = { name: "fork", remote: forkPath, token: "test" };
	const git = new GitRepository(execute, join(directory, "work.git"));
	await git.initialize();
	return { directory, source, upstream, fork, git, head: await run(source, "rev-parse", "HEAD") };
}
describe("real Git orchestration", () => {
	it.each([
		"quarantine:upstream-contributor",
		`namespace:upstream-contributor:refs/heads/quest/m0/cloudflare/intake:${"a".repeat(40)}:${"b".repeat(40)}`,
		`release:${"c".repeat(40)}:quest/m0/cloudflare/intake.md`,
	])("accepts deterministic opaque intake operation IDs: %s", async (operationId) => {
		const f = await fixture();
		const files = [{ path: "issues/opaque.md", content: "Request\n" }];
		const result = await f.git.applyMutation(f.upstream, f.head, operationId, files, author);
		expect((await f.git.applyMutation(f.upstream, f.head, operationId, files, author)).commitSha).toBe(
			result.commitSha,
		);
		const body = await run(f.directory, "--git-dir=" + f.upstream.remote, "log", "-1", "--format=%B");
		expect(body).toContain(await operationKey(operationId));
		expect(body).not.toContain(operationId);
	});
	it("recovers a succeeded push after response loss and later upstream advancement", async () => {
		const f = await fixture();
		let lost = false;
		const interrupted = new GitRepository(
			async (argv, options) => {
				const result = await execute(argv, options);
				if (argv.includes("push") && result.exitCode === 0 && !lost) {
					lost = true;
					throw new Error("Response lost");
				}
				return result;
			},
			join(f.directory, "lost.git"),
		);
		await interrupted.initialize();
		const files = [{ path: "issues/request.md", content: "Requested work\n" }];
		await expect(interrupted.applyMutation(f.upstream, f.head, "recovery1", files, author)).rejects.toThrow(
			"Response lost",
		);
		const original = await f.git.head(f.upstream, "refs/heads/main");
		expect(original).not.toBe(f.head);
		await f.git.applyMutation(
			f.upstream,
			original!,
			"later2",
			[{ path: "issues/another.md", content: "Later work\n" }],
			author,
		);
		const restarted = new GitRepository(execute, join(f.directory, "restarted.git"));
		await restarted.initialize();
		expect((await restarted.applyMutation(f.upstream, f.head, "recovery1", files, author)).commitSha).toBe(
			original,
		);
		expect(await f.git.head(f.upstream, "refs/heads/main")).not.toBe(original);
	});
	it("includes directories and exact quest bytes in complete snapshots", async () => {
		const f = await fixture();
		await f.git.fetch(f.upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const snapshot = await f.git.snapshot(f.head);
		expect(snapshot.paths).toContain("docs");
		expect(snapshot.paths).toContain("docs/readme.txt");
		expect(snapshot.documents).toEqual([
			{ path: "quest/task.md", content: "# [S] Task\n\n## Goal\n\nSee [docs](/docs).\n" },
		]);
	});
	it("credits writes, rejects stale expected heads, and keeps credentials out of config", async () => {
		const f = await fixture();
		const result = await f.git.applyMutation(
			f.upstream,
			f.head,
			"write1",
			[{ path: "issues/request.md", content: "Requested work\n" }],
			author,
		);
		expect(await run(f.directory, "--git-dir=" + f.upstream.remote, "log", "-1", "--format=%an <%ae>")).toBe(
			"Trusted Maintainer <maintainer@example.test>",
		);
		expect(result.commitSha).not.toBe(f.head);
		await expect(
			f.git.applyMutation(f.upstream, f.head, "write2", [{ path: "quest/task.md", content: null }], author),
		).rejects.toThrow("Upstream head moved");
		expect(await run(f.directory, "--git-dir=" + join(f.directory, "work.git"), "config", "--list")).not.toContain(
			"token",
		);
	});
	it("stores comments and approvals on immutable commits in upstream quest notes", async () => {
		const f = await fixture();
		await f.git.fetch(f.upstream, "refs/heads/main", "refs/remotes/upstream/main");
		const note = {
			version: 1 as const,
			kind: "approve" as const,
			operationId: "approve1",
			head: f.head,
			actor: { id: "maintainer", name: author.name },
			text: "Approved",
			time: "2026-10-01T00:00:00Z",
			upstreamHead: f.head,
			tree: f.head,
		};
		const first = await f.git.appendNote(f.upstream, note, author);
		expect(await f.git.notes(f.upstream, f.head)).toEqual([
			{ ...note, operationId: await operationKey(note.operationId) },
		]);
		expect(await f.git.appendNote(f.upstream, note, author)).toBe(first);
	});
	it("merges a proposal once, closes its retained fork head, and recognizes newer work", async () => {
		const f = await fixture();
		await run(f.source, "switch", "-c", "quest/new");
		await writeFile(join(f.source, "quest", "new.md"), "# [S] New\n\n## Goal\n\nProposed work.\n");
		await run(f.source, "add", ".");
		await run(f.source, "commit", "-m", "New proposal");
		const forkHead = await run(f.source, "rev-parse", "HEAD");
		await run(f.source, "push", f.fork.remote, "HEAD:refs/heads/quest/new");
		const candidate = await f.git.inspect(f.upstream, f.fork, "quest/new", forkHead);
		const result = await f.git.merge(
			f.upstream,
			f.fork,
			"quest/new",
			f.head,
			forkHead,
			candidate.tree!,
			[],
			author,
			"merge-proposal",
		);
		expect((await f.git.inspect(f.upstream, f.fork, "quest/new", forkHead)).merged).toBe(true);
		expect((await f.git.recoverMutation(f.upstream, f.head, candidate.tree!, "merge-proposal"))?.commitSha).toBe(
			result.commitSha,
		);
		await expect(
			f.git.merge(
				f.upstream,
				f.fork,
				"quest/new",
				result.commitSha,
				forkHead,
				candidate.tree!,
				[],
				author,
				"duplicate-merge",
			),
		).rejects.toThrow("Merge base changed");
		await writeFile(join(f.source, "quest", "new.md"), "# [S] New\n\n## Goal\n\nNewer proposed work.\n");
		await run(f.source, "commit", "-am", "Follow-up");
		const newer = await run(f.source, "rev-parse", "HEAD");
		await run(f.source, "push", f.fork.remote, "HEAD:refs/heads/quest/new");
		expect((await f.git.inspect(f.upstream, f.fork, "quest/new", newer)).merged).toBe(false);
	});
	it("reports merge conflicts without changing upstream", async () => {
		const f = await fixture();
		await run(f.source, "switch", "-c", "quest/task");
		await writeFile(join(f.source, "docs", "readme.txt"), "Fork change\n");
		await run(f.source, "commit", "-am", "Fork change");
		const forkHead = await run(f.source, "rev-parse", "HEAD");
		await run(f.source, "push", f.fork.remote, "HEAD:refs/heads/quest/task");
		await run(f.source, "switch", "main");
		await writeFile(join(f.source, "docs", "readme.txt"), "Upstream change\n");
		await run(f.source, "commit", "-am", "Upstream change");
		await run(f.source, "push", f.upstream.remote, "HEAD:refs/heads/main");
		const current = await run(f.source, "rev-parse", "HEAD");
		const inspected = await f.git.inspect(f.upstream, f.fork, "quest/task", forkHead);
		expect(inspected.conflicts).toContain("CONFLICT");
		expect(inspected.tree).toBeNull();
		expect(await f.git.head(f.upstream, "refs/heads/main")).toBe(current);
	});
});
