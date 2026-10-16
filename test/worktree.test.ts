import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Worktrees } from "../src/cli/worktree";
import { run } from "./fixture";

const roots: string[] = [];
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function repository(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.name", "Fixture");
	git(path, "config", "user.email", "fixture@localhost");
	writeFileSync(join(path, "file"), "original\n");
	writeFileSync(join(path, ".gitignore"), "cache/\n.env\n.worktrees/\n");
	git(path, "add", ".");
	git(path, "commit", "-m", "initial");
	return path;
}
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "quest-worktree-test-"));
	roots.push(root);
	const repo = repository(join(root, "repo"));
	const home = join(root, "state");
	const worktrees = new Worktrees(home);
	worktrees.configure(100_000_000);
	return { root, repo, home, worktrees };
}
/** Simulates a crash that left the only record mid-transition. */
function setPhase(home: string, phase: string): void {
	const registry = JSON.parse(readFileSync(join(home, "registry.json"), "utf8"));
	registry.records[0].phase = phase;
	writeFileSync(join(home, "registry.json"), JSON.stringify(registry));
}
const notes = {
	notes: "Remaining work: finish implementation",
	checks: ["unit tests not run"],
	keep: [] as string[],
	scratch: [] as string[],
};
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Each case runs 25-60 real Git processes. Process creation on the Windows ARM runner
// costs ~80-250 ms while other test files start, so the 5 s unit-test default is too short.
describe("recoverable worktrees", { timeout: 20_000 }, () => {
	it("preserves the staged index, unstaged source, additions, and deletions", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "file"), "staged\n");
		git(record.path, "add", "file");
		writeFileSync(join(record.path, "file"), "unstaged\n");
		git(record.path, "rm", ".gitignore");
		writeFileSync(join(record.path, "added"), "staged addition");
		git(record.path, "add", "added");
		writeFileSync(join(record.path, "added"), "modified addition");
		worktrees.release(record.id, notes);
		worktrees.restore(record.id);
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe("unstaged\n");
		expect(git(record.path, "show", ":file")).toBe("staged");
		expect(existsSync(join(record.path, ".gitignore"))).toBe(false);
		expect(git(record.path, "show", ":added")).toBe("staged addition");
		expect(readFileSync(join(record.path, "added"), "utf8")).toBe("modified addition");
	});
	it("restores within the original reservation while charging other retained checkpoints", () => {
		const { repo, worktrees } = fixture();
		const reserve = 1_000_000;
		worktrees.configure(reserve);
		const record = worktrees.create(repo, "work", reserve);
		worktrees.release(record.id, notes);
		worktrees.restore(record.id);
		expect(worktrees.status().allocated).toBe(reserve);
		worktrees.release(record.id, notes);
		const retained = worktrees.status().allocated;
		expect(retained).toBeGreaterThan(0);
		worktrees.create(repo, "other", reserve - retained);
		expect(() => worktrees.restore(record.id)).toThrow("disk capacity exceeded");
		expect(worktrees.status().records[0].phase).toBe("released");
	});
	it("preserves split-index entries after the disposable Git directory is gone", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "file"), "staged\n");
		git(record.path, "add", "file");
		writeFileSync(join(record.path, "file"), "unstaged\n");
		git(record.path, "update-index", "--split-index");
		const backing = git(record.path, "rev-parse", "--path-format=absolute", "--shared-index-path");
		expect(backing).not.toBe("");
		expect(existsSync(backing)).toBe(true);
		worktrees.checkpoint(record.id, notes);
		expect(git(record.path, "rev-parse", "--path-format=absolute", "--shared-index-path")).toBe(backing);
		const status = git(record.path, "status", "--porcelain=v1");
		worktrees.release(record.id, notes);
		expect(existsSync(backing)).toBe(false);
		worktrees.restore(record.id);
		expect(git(record.path, "status", "--porcelain=v1")).toBe(status);
		expect(git(record.path, "show", ":file")).toBe("staged");
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe("unstaged\n");
	});
	it.each(["file to directory", "directory to file"])("roundtrips staged %s replacements", (direction) => {
		const { repo, worktrees } = fixture();
		if (direction === "directory to file") {
			git(repo, "rm", "file");
			mkdirSync(join(repo, "file"));
			writeFileSync(join(repo, "file", "child"), "original\n");
			git(repo, "add", ".");
			git(repo, "commit", "-m", "start with directory");
		}
		const record = worktrees.create(repo, "work", 10_000_000);
		git(record.path, "rm", "-r", "file");
		const path = direction === "file to directory" ? "file/child" : "file";
		if (direction === "file to directory") mkdirSync(join(record.path, "file"));
		writeFileSync(join(record.path, path), "staged replacement\n");
		git(record.path, "add", ".");
		writeFileSync(join(record.path, path), "unstaged replacement\n");
		const status = git(record.path, "status", "--porcelain=v1");
		worktrees.release(record.id, notes);
		worktrees.restore(record.id);
		expect(git(record.path, "status", "--porcelain=v1")).toBe(status);
		expect(git(record.path, "show", `:${path}`)).toBe("staged replacement");
		expect(readFileSync(join(record.path, path), "utf8")).toBe("unstaged replacement\n");
	});
	it.skipIf(process.platform === "win32")("preserves tracked and retained relative symlink text", () => {
		const { repo, worktrees } = fixture();
		symlinkSync("file", join(repo, "link"));
		git(repo, "add", "link");
		git(repo, "commit", "-m", "track relative symlink");
		const record = worktrees.create(repo, "work", 10_000_000);
		symlinkSync("file", join(record.path, "kept-link"));
		mkdirSync(join(record.path, "kept-directory"));
		symlinkSync("../file", join(record.path, "kept-directory", "link"));
		worktrees.release(record.id, { ...notes, keep: ["kept-link", "kept-directory"] });
		worktrees.restore(record.id);
		expect(readlinkSync(join(record.path, "link"))).toBe("file");
		expect(readlinkSync(join(record.path, "kept-link"))).toBe("file");
		expect(readlinkSync(join(record.path, "kept-directory", "link"))).toBe("../file");
		expect(git(record.path, "diff", "HEAD")).toBe("");
	});
	it("retains unique committed history independently of the released checkout", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "file"), "unique committed\n");
		git(record.path, "add", "file");
		git(record.path, "commit", "-m", "local only");
		const unique = git(record.path, "rev-parse", "HEAD");
		worktrees.release(record.id, notes);
		expect(existsSync(record.path)).toBe(false);
		const released = worktrees.status();
		expect(released.records[0].phase).toBe("released");
		expect(released.retained).toBeGreaterThan(0);
		const snapshot = JSON.parse(readFileSync(join(released.records[0].checkpoint!, "snapshot.json"), "utf8"));
		expect(snapshot.notes).toBe(notes.notes);
		expect(snapshot.checks).toEqual(notes.checks);
		worktrees.restore(record.id);
		expect(git(record.path, "rev-parse", "HEAD")).toBe(unique);
	});
	it("restores detached even after the saved branch moves", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		git(record.path, "switch", "-c", "topic");
		writeFileSync(join(record.path, "file"), "topic\n");
		git(record.path, "commit", "-am", "topic");
		const unique = git(record.path, "rev-parse", "HEAD");
		worktrees.release(record.id, notes);
		git(repo, "branch", "-f", "topic", "main");
		worktrees.restore(record.id);
		expect(git(record.path, "rev-parse", "HEAD")).toBe(unique);
		expect(() => git(record.path, "symbolic-ref", "-q", "HEAD")).toThrow();
	});
	it("preserves explicitly valuable ignored and untracked files while removing disposable output", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, ".env"), "valuable private data");
		writeFileSync(join(record.path, "new-source"), "untracked source");
		mkdirSync(join(record.path, "cache"));
		writeFileSync(join(record.path, "cache", "artifact"), "disposable");
		worktrees.release(record.id, { ...notes, keep: [".env", "new-source"], scratch: ["cache"] });
		worktrees.restore(record.id);
		expect(readFileSync(join(record.path, ".env"), "utf8")).toBe("valuable private data");
		expect(readFileSync(join(record.path, "new-source"), "utf8")).toBe("untracked source");
		expect(existsSync(join(record.path, "cache"))).toBe(false);
	});

	it("never discards unclassified files or tracked source marked scratch", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "new"), "source");
		expect(() => worktrees.release(record.id, notes)).toThrow("classify untracked/ignored");
		expect(readFileSync(join(record.path, "new"), "utf8")).toBe("source");
		expect(() => worktrees.release(record.id, { ...notes, scratch: ["file", "new"] })).toThrow(
			"scratch includes tracked source",
		);
		expect(() => worktrees.checkpoint(record.id, { ...notes, keep: ["../outside"] })).toThrow("relative path");
		expect(() => worktrees.checkpoint(record.id, { ...notes, keep: ["new"], scratch: ["new"] })).toThrow("overlap");
	});
	it("serializes reservations across independent repositories and preserves failed allocations", () => {
		const { root, repo, home, worktrees } = fixture();
		const second = repository(join(root, "second"));
		worktrees.configure(20_000_000);
		worktrees.create(repo, "first", 12_000_000);
		expect(() => new Worktrees(home).create(second, "second", 12_000_000)).toThrow("disk capacity exceeded");
		expect(() => worktrees.configure(1_000_000)).toThrow("below existing");
		mkdirSync(join(home, "lock"));
		expect(() => worktrees.status()).toThrow("never remove a live lock");
		rmSync(join(home, "lock"), { recursive: true });
		expect(() => worktrees.create(second, "failed", 1_000_000, "nonexistent-ref")).toThrow();
		expect(worktrees.status().records.find((record) => record.name === "failed")?.phase).toBe("creating");
		worktrees.release("failed", notes);
		expect(worktrees.status().records.map((record) => record.name)).toEqual(["first"]);
	});
	it("admits simultaneous creators atomically without oversubscribing disk", async () => {
		const { root, repo, home, worktrees } = fixture();
		const second = repository(join(root, "second"));
		worktrees.configure(15_000_000);
		const module = new URL("../src/cli/worktree.ts", import.meta.url).href;
		const create = (repository: string, name: string) =>
			new Promise<number | null>((resolve, reject) => {
				const source = `import { Worktrees } from ${JSON.stringify(module)}; new Worktrees(${JSON.stringify(home)}).create(${JSON.stringify(repository)}, ${JSON.stringify(name)}, 10_000_000);`;
				const child = spawn(
					process.execPath,
					["--experimental-strip-types", "--input-type=module", "-e", source],
					{ stdio: "ignore" },
				);
				child.on("error", reject);
				child.on("exit", resolve);
			});
		const results = await Promise.all([create(repo, "one"), create(second, "two")]);
		expect(results.filter((result) => result === 0)).toHaveLength(1);
		expect(worktrees.status().records).toHaveLength(1);
		expect(worktrees.status().allocated).toBeLessThanOrEqual(15_000_000);
	});

	it("refuses foreign checkouts, changed ownership, and current checkouts", () => {
		const { repo, worktrees } = fixture();
		mkdirSync(join(repo, ".worktrees", "foreign"), { recursive: true });
		expect(() => worktrees.create(repo, "foreign", 10_000_000)).toThrow("refusing to adopt");
		const record = worktrees.create(repo, "work", 10_000_000);
		const cwd = process.cwd();
		try {
			process.chdir(record.path);
			expect(() => worktrees.release(record.id, notes)).toThrow("leave the checkout");
		} finally {
			process.chdir(cwd);
		}
		git(repo, "worktree", "unlock", record.path);
		git(repo, "worktree", "lock", "--reason", "another owner", record.path);
		expect(() => worktrees.release(record.id, notes)).toThrow("ownership/lock changed");
	});
	it("restores local-only submodule history and both staged and unstaged submodule edits", () => {
		const { root, repo, worktrees } = fixture();
		const globalConfig = join(root, "gitconfig");
		writeFileSync(globalConfig, "[init]\n\tdefaultBranch = master\n");
		vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
		const upstream = repository(join(root, "upstream"));
		git(repo, "-c", "protocol.file.allow=always", "submodule", "add", upstream, "module");
		git(repo, "commit", "-m", "add module");
		const record = worktrees.create(repo, "work", 20_000_000);
		git(record.path, "-c", "protocol.file.allow=always", "submodule", "update", "--init");
		const module = join(record.path, "module");
		git(module, "switch", "-c", "master");
		git(module, "config", "user.name", "Fixture");
		git(module, "config", "user.email", "fixture@localhost");
		writeFileSync(join(module, "file"), "local commit\n");
		git(module, "add", "file");
		git(module, "commit", "-m", "local-only module commit");
		const unique = git(module, "rev-parse", "HEAD");
		writeFileSync(join(module, "file"), "staged module\n");
		git(module, "add", "file");
		writeFileSync(join(module, "file"), "unstaged module\n");
		worktrees.release(record.id, notes);
		worktrees.restore(record.id);
		expect(git(module, "rev-parse", "HEAD")).toBe(unique);
		expect(git(module, "symbolic-ref", "HEAD")).toBe("refs/heads/master");
		expect(git(module, "config", "user.name")).toBe("Fixture");
		expect(git(module, "remote", "get-url", "origin")).toBe(upstream);
		expect(git(module, "show", ":file")).toBe("staged module");
		expect(readFileSync(join(module, "file"), "utf8")).toBe("unstaged module\n");
	});
	it("wires capacity, reservation, and checkpoint notes through the command line", () => {
		const { repo, home } = fixture();
		vi.stubEnv("QUEST_WORKTREE_HOME", home);
		expect(run("worktree", "create", "cli", "--root", repo).code).toBe(2);
		expect(run("worktree", "capacity", "0").code).toBe(2);
		const created = run("--root", repo, "worktree", "create", "cli", "--reserve", "10000000");
		expect(created.code).toBe(0);
		expect(JSON.parse(created.stdout).name).toBe("cli");
		expect(
			run("worktree", "checkpoint", "cli", "--notes", "Awaiting review", "--check", "tests not run").code,
		).toBe(0);
		const status = run("worktree", "status");
		expect(status.code).toBe(0);
		const checkpoint = JSON.parse(status.stdout).records[0].checkpoint;
		expect(JSON.parse(readFileSync(join(checkpoint, "snapshot.json"), "utf8")).checks).toEqual(["tests not run"]);
	});

	it("finishes an interrupted release without checkpointing the partial checkout", () => {
		const { repo, home, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		worktrees.checkpoint(record.id, notes);
		setPhase(home, "releasing");
		const original = readFileSync(join(record.path, "file"), "utf8"); // CRLF under Windows autocrlf.
		rmSync(join(record.path, "file")); // Removal stopped partway.
		expect(worktrees.status().allocated).toBeGreaterThanOrEqual(record.reserve);
		worktrees.release(record.id, notes);
		expect(worktrees.status().records[0].phase).toBe("released");
		expect(existsSync(record.path)).toBe(false);
		worktrees.restore(record.id);
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe(original);
	});
	it("retries or abandons an interrupted restore from the intact checkpoint", () => {
		const { repo, home, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "file"), "saved\n");
		worktrees.release(record.id, notes);
		const partial = () => {
			git(repo, "worktree", "add", "--detach", "--lock", "--reason", `quest worktree ${record.id}`, record.path);
			writeFileSync(join(record.path, "file"), "partial\n");
			setPhase(home, "restoring");
		};
		partial();
		expect(() => worktrees.checkpoint(record.id, notes)).toThrow("cannot checkpoint a restoring");
		worktrees.restore(record.id);
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe("saved\n");
		worktrees.release(record.id, notes);
		partial();
		expect(worktrees.release(record.id, notes).phase).toBe("released");
		expect(existsSync(record.path)).toBe(false);
		worktrees.restore(record.id);
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe("saved\n");
	});
});
