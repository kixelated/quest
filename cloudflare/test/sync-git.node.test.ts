import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GitRepository, type GitExecutor, type GitCapability } from "../src/git";
const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const execute: GitExecutor = (argv, options) =>
	new Promise((resolve, reject) => {
		const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...options.env }, stdio: "pipe" });
		let stdout = "",
			stderr = "";
		child.stdout.setEncoding("utf8").on("data", (value) => (stdout += value));
		child.stderr.setEncoding("utf8").on("data", (value) => (stderr += value));
		child.on("error", reject);
		child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
		child.stdin.end(options.stdin);
	});
async function run(cwd: string, ...args: string[]) {
	const result = await execute(["git", "-C", cwd, ...args], {
		env: {
			GIT_AUTHOR_NAME: "Fixture",
			GIT_AUTHOR_EMAIL: "fixture@localhost",
			GIT_COMMITTER_NAME: "Fixture",
			GIT_COMMITTER_EMAIL: "fixture@localhost",
		},
	});
	if (result.exitCode) throw new Error(result.stderr);
	return result.stdout.trim();
}
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "quest-sync-"));
	directories.push(dir);
	const source = join(dir, "source");
	await mkdir(source);
	await run(source, "init", "-b", "main");
	await writeFile(join(source, "README.md"), "Initial\n");
	await run(source, "add", ".");
	await run(source, "commit", "-m", "Initial");
	const left: GitCapability = { name: "artifacts", remote: join(dir, "artifacts.git"), token: "private-artifacts" },
		right: GitCapability = {
			name: "github",
			remote: join(dir, "github.git"),
			token: "private-github",
			authorization: "Basic eC1hY2Nlc3MtdG9rZW46cHJpdmF0ZS1naXRodWI=",
		};
	for (const remote of [left, right]) await run(source, "clone", "--bare", source, remote.remote);
	const git = new GitRepository(execute, join(dir, "work.git"));
	await git.initialize();
	return { dir, source, left, right, git, base: await run(source, "rev-parse", "HEAD") };
}
async function commit(
	f: Awaited<ReturnType<typeof fixture>>,
	message: string,
	remote: GitCapability,
	ref = "refs/heads/main",
) {
	await writeFile(join(f.source, "README.md"), message + "\n");
	await run(f.source, "commit", "-am", message);
	const sha = await run(f.source, "rev-parse", "HEAD");
	await run(f.source, "push", remote.remote, `HEAD:${ref}`);
	return sha;
}
describe("fast-forward-only mirror with real Git", () => {
	it("mirrors main and new quest branches both ways and ignores tags/other branches", async () => {
		const f = await fixture();
		const advanced = await commit(f, "Artifacts change", f.left);
		await run(
			f.source,
			"push",
			f.left.remote,
			"HEAD:refs/heads/quest/new",
			"HEAD:refs/heads/other",
			"HEAD:refs/tags/v-test",
		);
		const first = await f.git.mirror(f.left, f.right, {});
		expect(first.filter((row) => row.status === "updated")).toHaveLength(2);
		expect(await f.git.head(f.right, "refs/heads/main")).toBe(advanced);
		expect(await f.git.head(f.right, "refs/heads/quest/new")).toBe(advanced);
		expect(await f.git.head(f.right, "refs/heads/other")).toBeNull();
		const newer = await commit(f, "GitHub change", f.right);
		await f.git.mirror(f.left, f.right, Object.fromEntries(first.map((row) => [row.ref, row.shared!])));
		expect(await f.git.head(f.left, "refs/heads/main")).toBe(newer);
		expect(await f.git.mirror(f.left, f.right, {})).toEqual(
			expect.arrayContaining([expect.objectContaining({ ref: "refs/heads/main", status: "equal" })]),
		);
	});
	it("surfaces main and notes divergence without overwriting either side", async () => {
		const f = await fixture();
		const a = await commit(f, "Left divergent", f.left);
		await run(f.source, "reset", "--hard", f.base);
		const b = await commit(f, "Right divergent", f.right);
		await run(f.source, "notes", "--ref=quest", "add", "-m", "GitHub review", f.base);
		await run(f.source, "push", f.right.remote, "refs/notes/quest:refs/notes/quest");
		const notes = await f.git.mirror(f.left, f.right, {});
		expect(notes.find((row) => row.ref === "refs/heads/main")?.status).toBe("diverged");
		const originalNotes = await f.git.head(f.left, "refs/notes/quest");
		await run(f.source, "notes", "--ref=quest", "add", "-f", "-m", "New GitHub review", f.base);
		await run(f.source, "push", f.right.remote, "refs/notes/quest:refs/notes/quest");
		await run(f.source, "update-ref", "refs/notes/quest", originalNotes!);
		await run(f.source, "notes", "--ref=quest", "add", "-f", "-m", "New Artifacts review", f.base);
		await run(f.source, "push", f.left.remote, "refs/notes/quest:refs/notes/quest");
		const result = await f.git.mirror(f.left, f.right, {});
		expect(result.find((row) => row.ref === "refs/notes/quest")?.status).toBe("diverged");
		expect(await f.git.head(f.left, "refs/heads/main")).toBe(a);
		expect(await f.git.head(f.right, "refs/heads/main")).toBe(b);
	});
	it("mirrors dotted and Unicode quest refs while rejecting invalid scoped refs", async () => {
		const f = await fixture();
		for (const ref of [
			"refs/heads/quest/m0/foo.v2",
			"refs/heads/quest/日本語",
			"refs/heads/quest/space\u00a0name",
		]) {
			await run(f.source, "push", f.left.remote, `HEAD:${ref}`);
		}
		await f.git.mirror(f.left, f.right, {});
		expect(await f.git.head(f.right, "refs/heads/quest/m0/foo.v2")).toBe(f.base);
		expect(await f.git.head(f.right, "refs/heads/quest/日本語")).toBe(f.base);
		expect(await f.git.head(f.right, "refs/heads/quest/space\u00a0name")).toBe(f.base);
		for (const ref of ["refs/heads/quest/bad..ref", "refs/heads/quest/bad.lock", "refs/heads/quest/bad*"]) {
			await expect(f.git.head(f.right, ref)).rejects.toThrow();
			await expect(f.git.mirror(f.left, f.right, { [ref]: f.base })).rejects.toThrow();
		}
	});
	it("uses receipts to preserve deletion after a lost first-copy response and rejects stale receipt snapshots", async () => {
		const f = await fixture();
		const ref = "refs/heads/quest/lost";
		await run(f.source, "push", f.left.remote, `HEAD:${ref}`);
		const observed = { left: await f.git.refs(f.left), right: await f.git.refs(f.right) };
		const receipts = Object.fromEntries(
			Object.keys({ ...observed.left, ...observed.right }).map((ref) => [
				ref,
				observed.left[ref] ?? observed.right[ref],
			]),
		);
		await f.git.mirror(f.left, f.right, {}, observed);
		await run(f.source, "push", f.right.remote, `:${ref}`);
		const rows = await f.git.mirror(f.left, f.right, receipts);
		expect(rows.find((row) => row.ref === ref)?.status).toBe("deleted");
		expect(await f.git.head(f.right, ref)).toBeNull();
		await commit(f, "Moved after receipt", f.left, ref);
		await expect(f.git.mirror(f.left, f.right, {}, observed)).rejects.toThrow("Mirror refs moved since receipt");
	});
	it("does not resurrect or propagate deletion of an already mirrored ref", async () => {
		const f = await fixture();
		await run(f.source, "push", f.left.remote, "HEAD:refs/heads/quest/deleted");
		await run(f.source, "notes", "--ref=quest", "add", "-m", "Delete note", f.base);
		await run(f.source, "push", f.left.remote, "refs/notes/quest:refs/notes/quest");
		const first = await f.git.mirror(f.left, f.right, {});
		await run(f.source, "push", f.left.remote, ":refs/heads/quest/deleted", ":refs/notes/quest");
		const previous = Object.fromEntries(first.map((row) => [row.ref, row.shared!]));
		expect(
			(await f.git.mirror(f.left, f.right, previous)).find((row) => row.ref === "refs/heads/quest/deleted")
				?.status,
		).toBe("deleted");
		expect(await f.git.head(f.left, "refs/heads/quest/deleted")).toBeNull();
		expect(await f.git.head(f.right, "refs/heads/quest/deleted")).toBe(f.base);
		expect(
			(await f.git.mirror(f.left, f.right, previous)).find((row) => row.ref === "refs/notes/quest")?.status,
		).toBe("deleted");
		expect(await f.git.head(f.left, "refs/notes/quest")).toBeNull();
		expect(await f.git.head(f.right, "refs/notes/quest")).not.toBeNull();
	});
	it("recovers a lost push response by reconciling equal authoritative heads", async () => {
		const f = await fixture();
		await commit(f, "Landed once", f.left);
		let lost = false;
		const git = new GitRepository(
			async (argv, options) => {
				const result = await execute(argv, options);
				if (argv.includes("push") && result.exitCode === 0 && !lost) {
					lost = true;
					throw new Error("Lost response");
				}
				return result;
			},
			join(f.dir, "lost.git"),
		);
		await git.initialize();
		await expect(git.mirror(f.left, f.right, {})).rejects.toThrow("Lost response");
		expect((await f.git.mirror(f.left, f.right, {})).every((row) => row.status === "equal")).toBe(true);
	});
	it("rejects a raced notes update using the exact old-SHA lease", async () => {
		const f = await fixture();
		await run(f.source, "notes", "--ref=quest", "add", "-m", "Initial note", f.base);
		await run(f.source, "push", f.left.remote, "refs/notes/quest:refs/notes/quest");
		await f.git.mirror(f.left, f.right, {});
		const notesBase = await f.git.head(f.left, "refs/notes/quest");
		await run(f.source, "notes", "--ref=quest", "add", "-f", "-m", "New left note", f.base);
		await run(f.source, "push", f.left.remote, "refs/notes/quest:refs/notes/quest");
		const newer = await f.git.head(f.left, "refs/notes/quest");
		await run(f.source, "update-ref", "refs/notes/quest", notesBase!);
		await run(f.source, "notes", "--ref=quest", "add", "-f", "-m", "Concurrent right note", f.base);
		const raced = await run(f.source, "rev-parse", "refs/notes/quest");
		let changed = false;
		const git = new GitRepository(
			async (argv, options) => {
				if (argv.includes("push") && !changed) {
					changed = true;
					await run(f.source, "push", f.right.remote, "refs/notes/quest:refs/notes/quest");
				}
				return execute(argv, options);
			},
			join(f.dir, "race.git"),
		);
		await git.initialize();
		await expect(git.mirror(f.left, f.right, {})).rejects.toThrow("Git push failed");
		expect(await f.git.head(f.right, "refs/notes/quest")).toBe(raced);
		expect(await f.git.head(f.left, "refs/notes/quest")).toBe(newer);
	});
});
