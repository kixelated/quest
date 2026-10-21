import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Retained, type Scopes, currentOwner } from "../src/cli/supervise";
import { main } from "../src/cli/main";
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

/** Scopes whose runs finish when the test says so, and stay live while listed. */
function fakeScopes() {
	const live = new Set<string>();
	const finish = new Map<string, (code: number) => void>();
	const scopes: Scopes = {
		check() {},
		live: (unit) => live.has(unit),
		run: (unit) => new Promise((resolve) => finish.set(unit, resolve)),
	};
	return { live, finish, scopes };
}
function fixture(scopes?: Scopes) {
	const root = mkdtempSync(join(tmpdir(), "quest-worktree-test-"));
	roots.push(root);
	const repo = repository(join(root, "repo"));
	const home = join(root, "state");
	const worktrees = new Worktrees(home, scopes);
	worktrees.configure(100_000_000);
	return { root, repo, home, worktrees };
}
/** A process that has exited, identified so it can never match a live one. */
function deadOwner() {
	return { host: hostname(), pid: spawnSync(process.execPath, ["-e", ""]).pid!, start: "0" };
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
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache/", "cache/nested", "missing"]);
		expect(record.scratch).toEqual(["cache", "cache/nested", "missing"]);
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
		expect(worktrees.release(record.id).phase).toBe("released");
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
		for (const path of ["../outside", ".git", ".GIT", "/absolute", "."])
			expect(() => worktrees.create(repo, "invalid", 10_000_000, "HEAD", [path])).toThrow("relative path");
		let count = 0;
		const declare = (scratch: string) => {
			const record = worktrees.create(repo, `case-${count++}`, 1_000_000, "HEAD", [scratch]);
			writeFileSync(join(record.path, "new"), "source");
			mkdirSync(join(record.path, "cache"));
			writeFileSync(join(record.path, "cache", "forced"), "tracked despite the ignore rule");
			git(record.path, "add", "-f", "cache/forced");
			return record;
		};
		expect(() => worktrees.release(declare("file").id)).toThrow("tracked files: file");
		expect(() => worktrees.release(declare("cache").id)).toThrow("tracked files: cache/forced");
		// Another spelling, which a case-insensitive filesystem resolves to the tracked directory.
		const aliased = declare("CACHE");
		mkdirSync(join(aliased.path, "CACHE"), { recursive: true });
		appendFileSync(join(repo, ".git", "info", "exclude"), "/CACHE/\n");
		expect(() => worktrees.release(aliased.id)).toThrow("tracked files: cache/forced");
		const unignored = declare("new");
		expect(() => worktrees.release(unignored.id)).toThrow("ignored by Git: new");
		// Any other alias of the .git entry, here a hard link that an ignore rule matches.
		const linked = declare(".env");
		linkSync(join(linked.path, ".git"), join(linked.path, ".env"));
		expect(() => worktrees.release(linked.id)).toThrow(".git entry: .env");
		expect(readFileSync(join(unignored.path, "new"), "utf8")).toBe("source");
		expect(readFileSync(join(unignored.path, "cache", "forced"), "utf8")).toBe("tracked despite the ignore rule");
		expect(worktrees.status().records.every((record) => record.phase === "active")).toBe(true);
	});
	it.skipIf(process.platform === "win32")("never follows symlinks out of the checkout", () => {
		const { root, repo, worktrees } = fixture();
		const outside = join(root, "outside");
		mkdirSync(join(outside, "cache"), { recursive: true });
		writeFileSync(join(outside, "cache", "keep"), "outside");
		const through = worktrees.create(repo, "through", 10_000_000, "HEAD", ["linked/cache"]);
		symlinkSync(outside, join(through.path, "linked"));
		expect(() => worktrees.release(through.id)).toThrow("reached through a symlink");
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache", ".env"]);
		mkdirSync(join(record.path, "cache"));
		symlinkSync(outside, join(record.path, "cache", "link"));
		symlinkSync(outside, join(record.path, ".env"));
		worktrees.release(record.id);
		expect(existsSync(join(record.path, "cache"))).toBe(false);
		expect(existsSync(join(record.path, ".env"))).toBe(false);
		expect(readFileSync(join(outside, "cache", "keep"), "utf8")).toBe("outside");
	});
	it.skipIf(process.platform === "win32")("unlinks a scratch symlink to another worktree", () => {
		const { repo, worktrees } = fixture();
		const other = worktrees.create(repo, "other", 10_000_000);
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", [".env"]);
		symlinkSync(other.path, join(record.path, ".env"));
		expect(worktrees.release(record.id).phase).toBe("released");
		expect(existsSync(join(record.path, ".env"))).toBe(false);
		expect(existsSync(join(other.path, "file"))).toBe(true);
	});
	it.skipIf(process.platform === "win32")("charges allocated blocks of dangling symlinks and sparse files", () => {
		const { root } = fixture();
		const dangling = join(root, "dangling");
		symlinkSync("missing", dangling);
		expect(diskUsage(dangling)).toBe(lstatSync(dangling).blocks * 512);
		const sparse = join(root, "sparse");
		writeFileSync(sparse, "");
		truncateSync(sparse, 1 << 30);
		expect(diskUsage(sparse)).toBeLessThan(1 << 20);
		const linked = join(root, "linked");
		mkdirSync(linked);
		writeFileSync(join(linked, "a"), Buffer.alloc(1 << 16, 1));
		linkSync(join(linked, "a"), join(linked, "b"));
		expect(diskUsage(linked)).toBe((lstatSync(linked).blocks + lstatSync(join(linked, "a")).blocks) * 512);
	});
	it("charges active reservations and the footprint released checkouts keep", () => {
		const { repo, worktrees } = fixture();
		const reserve = 1_000_000;
		worktrees.configure(reserve);
		const record = worktrees.create(repo, "work", reserve);
		expect(worktrees.status().allocated).toBe(reserve);
		worktrees.release(record.id);
		const retained = worktrees.status().allocated;
		expect(retained).toBeGreaterThan(0);
		expect(retained).toBeLessThan(reserve);
		worktrees.create(repo, "other", reserve - retained);
		expect(() => worktrees.restore(record.id)).toThrow("disk capacity exceeded");
		expect(worktrees.status().records[0].phase).toBe("released");
	});
	it("drops the record once its checkout is removed", () => {
		const { repo, worktrees } = fixture();
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["missing"]);
		expect(() => worktrees.release(record.id)).not.toThrow();
		git(repo, "worktree", "unlock", record.path);
		git(repo, "worktree", "remove", record.path);
		worktrees.release(record.id);
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
		expect(() => worktrees.create(second, "failed", 1_000_000, "nonexistent-ref")).toThrow();
		expect(worktrees.status().records.find((record) => record.name === "failed")?.phase).toBe("creating");
		worktrees.release("failed");
		expect(worktrees.status().records.map((record) => record.name)).toEqual(["first"]);
	});
	it("never steals a live registry lock and reclaims one whose owner exited", () => {
		const { home, worktrees } = fixture();
		const lock = join(home, "lock");
		mkdirSync(lock);
		writeFileSync(join(lock, "live.json"), JSON.stringify(currentOwner()));
		expect(() => worktrees.status()).toThrow(`locked by process ${process.pid}`);
		// Another host's process cannot be checked, so it is assumed to be live.
		writeFileSync(join(lock, "live.json"), JSON.stringify({ ...deadOwner(), host: "elsewhere" }));
		expect(() => worktrees.status()).toThrow("on elsewhere");
		writeFileSync(join(lock, "live.json"), JSON.stringify(deadOwner()));
		expect(worktrees.status().capacity).toBe(100_000_000);
		expect(existsSync(lock)).toBe(false);
		// An empty lock is one whose owner was releasing or reclaiming it.
		mkdirSync(lock);
		expect(worktrees.status().capacity).toBe(100_000_000);
		expect(existsSync(lock)).toBe(false);
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
		expect(() => worktrees.release(record.id)).toThrow("ownership/lock changed");
		expect(() => worktrees.restore(record.id)).toThrow("ownership/lock changed");
	});
	it("refuses scratch that contains another Git worktree", () => {
		const { root, repo, worktrees } = fixture();
		const outer = worktrees.create(repo, "outer", 10_000_000, "HEAD", [".worktrees"]);
		// Created from inside the outer checkout, so it lands in the outer checkout's ignored .worktrees/.
		const inner = worktrees.create(outer.path, "inner", 10_000_000);
		expect(inner.path).toBe(join(outer.path, ".worktrees", "inner"));
		expect(() => worktrees.release(outer.id)).toThrow("scratch contains a Git worktree");
		expect(existsSync(join(inner.path, "file"))).toBe(true);
		// A linked worktree of an unrelated repository, such as an agent's checkout under an ignored directory.
		const other = worktrees.create(repo, "other", 10_000_000, "HEAD", ["cache"]);
		const foreign = repository(join(root, "foreign"));
		git(foreign, "worktree", "add", "--detach", join(other.path, "cache", "agent"));
		expect(() => worktrees.release(other.id)).toThrow("scratch contains a Git worktree: cache");
		expect(existsSync(join(other.path, "cache", "agent", "file"))).toBe(true);
		expect(worktrees.status().records.map((record) => record.phase)).toEqual(["active", "active", "active"]);
	});
	it.skipIf(process.platform === "win32")("refuses a root replaced by a link to another checkout", () => {
		const { repo, worktrees } = fixture();
		const replaced = worktrees.create(repo, "first", 10_000_000, "HEAD", ["cache"]);
		const other = worktrees.create(repo, "second", 10_000_000);
		mkdirSync(join(other.path, "cache"));
		rmSync(replaced.path, { recursive: true });
		symlinkSync(other.path, replaced.path);
		expect(() => worktrees.release(replaced.id)).toThrow("ownership/lock changed");
		expect(existsSync(join(other.path, "cache"))).toBe(true);
	});
	it("wires capacity, reservation, and scratch through the command line", () => {
		const { repo, home } = fixture();
		vi.stubEnv("QUEST_WORKTREE_HOME", home);
		expect(run("worktree", "create", "cli", "--root", repo).code).toBe(2);
		expect(run("worktree", "capacity", "0").code).toBe(2);
		const created = run("--root", repo, "worktree", "create", "cli", "--reserve", "10000000", "--scratch", "cache");
		expect(created.code).toBe(0);
		const { path } = JSON.parse(created.stdout);
		mkdirSync(join(path, "cache"));
		expect(run("worktree", "release", "cli").code).toBe(0);
		expect(existsSync(join(path, "cache"))).toBe(false);
		const status = run("worktree", "status");
		expect(status.code).toBe(0);
		expect(JSON.parse(status.stdout).records[0].phase).toBe("released");
	});
});

describe("supervised runs", { timeout: 20_000 }, () => {
	it("keeps scratch while any run is live and prunes it once the last one stops", async () => {
		const { finish, scopes } = fakeScopes();
		const { repo, worktrees } = fixture(scopes);
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		worktrees.release(record.id);
		// A run restores a released checkout before it starts.
		const first = worktrees.run(record.id, ["first"]);
		const second = worktrees.run(record.id, ["second"]);
		const units = worktrees.status().records[0].runs.map((run) => run.unit);
		expect(units).toHaveLength(2);
		expect(worktrees.status().records[0].phase).toBe("active");
		mkdirSync(join(record.path, "cache"));
		expect(() => worktrees.release(record.id)).toThrow("supervised runs are live");
		finish.get(units[0])!(0);
		expect(await first).toEqual({ code: 0, failure: undefined });
		expect(existsSync(join(record.path, "cache"))).toBe(true);
		finish.get(units[1])!(7);
		expect(await second).toEqual({ code: 7, failure: undefined });
		expect(existsSync(join(record.path, "cache"))).toBe(false);
		expect(worktrees.status().records[0]).toMatchObject({ phase: "released", runs: [] });
	});
	it("reconciles a crashed supervisor only once its scope is empty", () => {
		const { live, scopes } = fakeScopes();
		const { repo, home, worktrees } = fixture(scopes);
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		mkdirSync(join(record.path, "cache"));
		const file = join(home, "registry.json");
		const registry = JSON.parse(readFileSync(file, "utf8"));
		registry.records[0].runs = [{ unit: "orphan.scope", owner: deadOwner() }];
		writeFileSync(file, JSON.stringify(registry));
		live.add("orphan.scope");
		expect(worktrees.status().records[0].runs).toHaveLength(1);
		expect(() => worktrees.release(record.id)).toThrow("supervised runs are live");
		expect(existsSync(join(record.path, "cache"))).toBe(true);
		live.delete("orphan.scope");
		expect(worktrees.status().records[0]).toMatchObject({ phase: "released", runs: [] });
		expect(existsSync(join(record.path, "cache"))).toBe(false);
	});
	it("treats a run it cannot inspect as live", () => {
		const { repo, home } = fixture();
		const worktrees = new Worktrees(home, {
			check() {},
			live: () => {
				throw new Error("no user manager");
			},
			run: () => Promise.resolve(0),
		});
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		mkdirSync(join(record.path, "cache"));
		const file = join(home, "registry.json");
		const registry = JSON.parse(readFileSync(file, "utf8"));
		registry.records[0].runs = [{ unit: "orphan.scope", owner: deadOwner() }];
		writeFileSync(file, JSON.stringify(registry));
		expect(worktrees.status().records[0]).toMatchObject({
			phase: "active",
			failure: expect.stringContaining("no user manager"),
		});
		expect(existsSync(join(record.path, "cache"))).toBe(true);
	});
	it("reports a failed release as a retained reservation", async () => {
		const { finish, scopes } = fakeScopes();
		const { repo, worktrees } = fixture(scopes);
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		const running = worktrees.run(record.id, ["build"]);
		mkdirSync(join(record.path, "cache"));
		writeFileSync(join(record.path, "cache", "forced"), "tracked");
		git(record.path, "add", "-f", "cache/forced");
		finish.get(worktrees.status().records[0].runs[0].unit)!(0);
		const result = await running;
		expect(result.code).toBe(0);
		expect(result.failure).toContain("tracked files: cache/forced");
		expect(worktrees.status().records[0]).toMatchObject({ phase: "active", runs: [] });
	});
	it("keeps scratch when the command never started", async () => {
		const { repo, home } = fixture();
		const worktrees = new Worktrees(home, {
			check() {},
			live: () => false,
			run: () => Promise.reject(new Error("no user manager")),
		});
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		mkdirSync(join(record.path, "cache"));
		await expect(worktrees.run(record.id, ["build"])).rejects.toThrow("no user manager");
		expect(worktrees.status().records[0]).toMatchObject({ phase: "active", runs: [] });
		expect(existsSync(join(record.path, "cache"))).toBe(true);
	});
	it("keeps a run recorded when its processes cannot be confirmed stopped", async () => {
		const { repo, home } = fixture();
		const worktrees = new Worktrees(home, {
			check() {},
			live: () => false,
			run: () => Promise.reject(new Retained("cannot confirm that the scope stopped")),
		});
		const record = worktrees.create(repo, "work", 10_000_000, "HEAD", ["cache"]);
		mkdirSync(join(record.path, "cache"));
		await expect(worktrees.run(record.id, ["build"])).rejects.toThrow("cannot confirm");
		// This process owns the run until it exits; then reconciliation asks the scope.
		expect(worktrees.status().records[0]).toMatchObject({
			phase: "active",
			failure: "cannot confirm that the scope stopped",
		});
		expect(worktrees.status().records[0].runs).toHaveLength(1);
		expect(() => worktrees.release(record.id)).toThrow("supervised runs are live");
		expect(existsSync(join(record.path, "cache"))).toBe(true);
	});
	it.skipIf(process.platform === "linux")("fails explicitly without a supported backend", async () => {
		const { repo, home } = fixture();
		vi.stubEnv("QUEST_WORKTREE_HOME", home);
		expect(run("--root", repo, "worktree", "create", "cli", "--reserve", "10000000").code).toBe(0);
		let stderr = "";
		const code = await main(["worktree", "run", "cli", "--", "git", "status"], {
			stdout: () => {},
			stderr: (text) => {
				stderr += text;
			},
		});
		expect(code).toBe(1);
		expect(stderr).toContain("needs Linux with a systemd user manager");
		expect(new Worktrees(home).status().records[0].runs).toEqual([]);
	});
});
