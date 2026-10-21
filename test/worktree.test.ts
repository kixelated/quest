import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Worktrees, diskUsage } from "../src/cli/worktree";
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
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Cases run up to 20 real Git processes. Process creation on the Windows ARM runner
// costs ~80-250 ms while other test files start, so the 5 s unit-test default is too short.
describe("worktrees", { timeout: 20_000 }, () => {
	it("prunes declared scratch in place and keeps source, Git state, and untracked files", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "file"), "committed\n");
		git(record.path, "commit", "-am", "local only");
		const head = git(record.path, "rev-parse", "HEAD");
		writeFileSync(join(record.path, "file"), "staged\n");
		git(record.path, "add", "file");
		writeFileSync(join(record.path, "file"), "unstaged\n");
		writeFileSync(join(record.path, "new-source"), "untracked source");
		writeFileSync(join(record.path, ".env"), "ignored and undeclared");
		mkdirSync(join(record.path, "cache", "nested"), { recursive: true });
		writeFileSync(join(record.path, "cache", "nested", "artifact"), "disposable");
		const status = git(record.path, "status", "--porcelain=v1");
		expect(worktrees.release(record.id, ["cache/", "missing"]).phase).toBe("released");
		expect(existsSync(join(record.path, "cache"))).toBe(false);
		expect(git(record.path, "status", "--porcelain=v1")).toBe(status);
		expect(git(record.path, "rev-parse", "HEAD")).toBe(head);
		expect(git(record.path, "show", ":file")).toBe("staged");
		expect(readFileSync(join(record.path, "file"), "utf8")).toBe("unstaged\n");
		expect(readFileSync(join(record.path, "new-source"), "utf8")).toBe("untracked source");
		expect(readFileSync(join(record.path, ".env"), "utf8")).toBe("ignored and undeclared");
		expect(worktrees.restore(record.id).phase).toBe("active");
	});
	it("refuses scratch that is tracked, not ignored, or outside the checkout", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		writeFileSync(join(record.path, "new"), "source");
		mkdirSync(join(record.path, "cache"));
		writeFileSync(join(record.path, "cache", "forced"), "tracked despite the ignore rule");
		git(record.path, "add", "-f", "cache/forced");
		expect(() => worktrees.release(record.id, ["file"])).toThrow("tracked files: file");
		expect(() => worktrees.release(record.id, ["cache"])).toThrow("tracked files: cache/forced");
		expect(() => worktrees.release(record.id, ["new"])).toThrow("ignored by Git: new");
		expect(() => worktrees.release(record.id, ["../outside"])).toThrow("relative path");
		expect(() => worktrees.release(record.id, [".git"])).toThrow("relative path");
		expect(readFileSync(join(record.path, "new"), "utf8")).toBe("source");
		expect(readFileSync(join(record.path, "cache", "forced"), "utf8")).toBe("tracked despite the ignore rule");
		expect(worktrees.status().records[0].phase).toBe("active");
	});
	it.skipIf(process.platform === "win32")("never follows symlinks out of the checkout", () => {
		const { root, repo, worktrees } = fixture();
		const outside = join(root, "outside");
		mkdirSync(join(outside, "cache"), { recursive: true });
		writeFileSync(join(outside, "cache", "keep"), "outside");
		const record = worktrees.create(repo, "work", 10_000_000);
		symlinkSync(outside, join(record.path, "linked"));
		expect(() => worktrees.release(record.id, ["linked/cache"])).toThrow("reached through a symlink");
		mkdirSync(join(record.path, "cache"));
		symlinkSync(outside, join(record.path, "cache", "link"));
		symlinkSync(outside, join(record.path, ".env"));
		worktrees.release(record.id, ["cache", ".env"]);
		expect(existsSync(join(record.path, "cache"))).toBe(false);
		expect(existsSync(join(record.path, ".env"))).toBe(false);
		expect(readFileSync(join(outside, "cache", "keep"), "utf8")).toBe("outside");
	});
	it.skipIf(process.platform === "win32")("counts dangling symlinks", () => {
		const { root } = fixture();
		symlinkSync("missing", join(root, "dangling"));
		expect(diskUsage(join(root, "dangling"))).toBeGreaterThan(0);
	});
	it("charges active reservations and the footprint released checkouts keep", () => {
		const { repo, worktrees } = fixture();
		const reserve = 1_000_000;
		worktrees.configure(reserve);
		const record = worktrees.create(repo, "work", reserve);
		expect(worktrees.status().allocated).toBe(reserve);
		worktrees.release(record.id, []);
		const retained = worktrees.status().allocated;
		expect(retained).toBeGreaterThan(0);
		expect(retained).toBeLessThan(reserve);
		worktrees.create(repo, "other", reserve - retained);
		expect(() => worktrees.restore(record.id)).toThrow("disk capacity exceeded");
		expect(worktrees.status().records[0].phase).toBe("released");
	});
	it("drops the record once its checkout is removed", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000);
		expect(() => worktrees.release(record.id, ["missing"])).not.toThrow();
		git(repo, "worktree", "unlock", record.path);
		git(repo, "worktree", "remove", record.path);
		worktrees.release(record.id, []);
		expect(worktrees.status().records).toEqual([]);
		expect(() => worktrees.restore(record.id)).toThrow("unknown worktree");
		expect(worktrees.create(repo, "work", 10_000_000).phase).toBe("active");
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
		worktrees.release("failed", []);
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
	it("refuses foreign checkouts and changed ownership", () => {
		const { repo, worktrees } = fixture();
		mkdirSync(join(repo, ".worktrees", "foreign"), { recursive: true });
		expect(() => worktrees.create(repo, "foreign", 10_000_000)).toThrow("refusing to adopt");
		const record = worktrees.create(repo, "work", 10_000_000);
		git(repo, "worktree", "unlock", record.path);
		git(repo, "worktree", "lock", "--reason", "another owner", record.path);
		expect(() => worktrees.release(record.id, [])).toThrow("ownership/lock changed");
		expect(() => worktrees.restore(record.id)).toThrow("ownership/lock changed");
	});
	it("wires capacity, reservation, and scratch through the command line", () => {
		const { repo, home } = fixture();
		vi.stubEnv("QUEST_WORKTREE_HOME", home);
		expect(run("worktree", "create", "cli", "--root", repo).code).toBe(2);
		expect(run("worktree", "capacity", "0").code).toBe(2);
		const created = run("--root", repo, "worktree", "create", "cli", "--reserve", "10000000");
		expect(created.code).toBe(0);
		const { path } = JSON.parse(created.stdout);
		mkdirSync(join(path, "cache"));
		expect(run("worktree", "release", "cli", "--scratch", "cache").code).toBe(0);
		expect(existsSync(join(path, "cache"))).toBe(false);
		const status = run("worktree", "status");
		expect(status.code).toBe(0);
		expect(JSON.parse(status.stdout).records[0].phase).toBe("released");
	});
});
