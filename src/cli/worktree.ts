// Git checkouts under a shared disk budget. Release prunes declared scratch in place.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	type Stats,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	statfsSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface WorktreeRecord {
	id: string;
	name: string;
	repository: string;
	path: string;
	reserve: number;
	phase: "creating" | "active" | "released";
	failure?: string;
}
interface Registry {
	version: 1;
	capacity: number;
	records: WorktreeRecord[];
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}
function save(path: string, value: unknown): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}
/** The entry itself, without following a final symlink; undefined when it is missing. */
function entry(path: string): Stats | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
/** The filesystem holding a path, or its nearest existing ancestor. */
function device(path: string): number {
	try {
		return statSync(path).dev;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
		return device(dirname(path));
	}
}
/** One spelling per path: Git prints `C:/...`, Node `C:\...`, and Windows may use 8.3 names. */
function canonical(path: string): string {
	return existsSync(path) ? realpathSync.native(path) : resolve(path);
}
/** Git's registered checkouts, with canonical paths and lock reasons. */
function checkouts(repository: string): { path: string; locked?: string }[] {
	return git(repository, "worktree", "list", "--porcelain", "-z")
		.split("\0\0")
		.flatMap((entry) => {
			const lines = entry.split("\0");
			const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
			const locked = lines.find((line) => line === "locked" || line.startsWith("locked "))?.slice(7);
			return path ? [{ path: canonical(path), locked }] : [];
		});
}
function childPath(path: string): string {
	if (
		!path ||
		isAbsolute(path) ||
		path.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".git") ||
		resolve("/", path) === "/"
	) {
		throw new Error(`expected a relative path without .. or .git: ${path}`);
	}
	return path.replaceAll("\\", "/").replace(/\/$/, "");
}
/** Whether a scratch path exists; refuses one reached through a symlink, which could leave the checkout. */
function present(root: string, path: string): boolean {
	const parts = path.split("/");
	for (let i = 1; i <= parts.length; i++) {
		const stat = entry(join(root, ...parts.slice(0, i)));
		if (!stat) return false;
		if (i < parts.length && !stat.isDirectory())
			throw new Error(`scratch path is reached through a symlink or file: ${path}`);
	}
	return true;
}
/** The paths Git ignores; check-ignore exits 1 when it matches none. */
function ignored(root: string, paths: string[]): Set<string> {
	try {
		const output = execFileSync("git", ["-C", root, "check-ignore", "-z", "--stdin"], {
			encoding: "utf8",
			input: `${paths.join("\0")}\0`,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return new Set(output.split("\0"));
	} catch (error) {
		if ((error as { status?: number }).status === 1) return new Set();
		throw error;
	}
}

/**
 * Git's lock reason for the checkout actually at `path`, read through its own `.git` file and
 * administrative directory, so a root replaced by another checkout reports that checkout's lock.
 */
function lockReason(path: string): string | undefined {
	try {
		const admin = /^gitdir: (.+)$/m.exec(readFileSync(join(path, ".git"), "utf8"))?.[1];
		return admin && readFileSync(resolve(path, admin.trim(), "locked"), "utf8").replace(/\r?\n$/, "");
	} catch (error) {
		if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
		throw error;
	}
}

/** Allocated blocks, including ignored build output; symlinks are never traversed. */
export function diskUsage(path: string): number {
	const stat = entry(path);
	if (!stat) return 0;
	// Allocated blocks, not logical length, so sparse files are not overcharged. Windows reports no blocks.
	let bytes = process.platform === "win32" ? stat.size : stat.blocks * 512;
	if (stat.isDirectory()) for (const child of readdirSync(path)) bytes += diskUsage(join(path, child));
	return bytes;
}

/** All allocations share one registry across repositories for this user/host. */
export class Worktrees {
	readonly home: string;
	constructor(
		home = process.env.QUEST_WORKTREE_HOME ??
			join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "quest", "worktrees"),
	) {
		mkdirSync(home, { recursive: true, mode: 0o700 });
		this.home = realpathSync(home);
	}
	private locked<T>(action: (registry: Registry) => T): T {
		const lock = join(this.home, "lock");
		try {
			mkdirSync(lock, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new Error(
					`worktree registry is locked: ${lock}; never remove a live lock; after a crash inspect owner.json and reconcile it explicitly`,
				);
			throw error;
		}
		try {
			save(join(lock, "owner.json"), { pid: process.pid, started: new Date().toISOString() });
			const file = join(this.home, "registry.json");
			const registry: Registry = existsSync(file)
				? JSON.parse(readFileSync(file, "utf8"))
				: { version: 1, capacity: 0, records: [] };
			if (registry.version !== 1) throw new Error("unsupported worktree registry version");
			try {
				return action(registry);
			} finally {
				save(file, registry);
			}
		} finally {
			rmSync(lock, { recursive: true });
		}
	}
	private find(registry: Registry, id: string): WorktreeRecord {
		const record = registry.records.find((item) => item.id === id || item.name === id);
		if (!record) throw new Error(`unknown worktree: ${id}`);
		return record;
	}
	/**
	 * Bytes on disk, plus the growth active reservations still expect. Released checkouts keep only
	 * what remains. `local` is the expected growth on the filesystem holding `parent`.
	 */
	private usage(registry: Registry, parent?: string): { used: number; growth: number; local: number } {
		const target = parent === undefined ? undefined : device(parent);
		let used = 0;
		let growth = 0;
		let local = 0;
		for (const record of registry.records) {
			const bytes = diskUsage(record.path);
			used += bytes;
			if (record.phase === "released") continue;
			const expected = Math.max(0, record.reserve - bytes);
			growth += expected;
			if (target !== undefined && device(record.path) === target) local += expected;
		}
		return { used, growth, local };
	}
	private admit(registry: Registry, reserve: number, parent: string): void {
		const { used, growth, local } = this.usage(registry, parent);
		if (used + growth + reserve > registry.capacity)
			throw new Error(
				`disk capacity exceeded: ${used + growth} allocated + ${reserve} requested > ${registry.capacity}`,
			);
		const fs = statfsSync(parent);
		if (Number(fs.bavail) * Number(fs.bsize) < local + reserve)
			throw new Error("insufficient free space after accounting for concurrent build reservations");
	}
	/** Capacity persists; reducing it below existing allocations is rejected. */
	configure(capacity: number): void {
		this.locked((registry) => {
			if (!Number.isSafeInteger(capacity) || capacity <= 0)
				throw new Error("capacity must be a positive safe integer in bytes");
			const { used, growth } = this.usage(registry);
			if (used + growth > capacity) throw new Error("capacity is below existing allocations");
			registry.capacity = capacity;
		});
	}
	status(): { capacity: number; allocated: number; records: WorktreeRecord[] } {
		return this.locked((registry) => {
			const { used, growth } = this.usage(registry);
			return { capacity: registry.capacity, allocated: used + growth, records: registry.records };
		});
	}
	create(root: string, name: string, reserve: number, ref = "HEAD"): WorktreeRecord {
		return this.locked((registry) => {
			if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
				throw new Error("name must contain only letters, digits, dots, underscores, or hyphens");
			if (!Number.isSafeInteger(reserve) || reserve <= 0)
				throw new Error("reserve must be a positive safe integer in bytes, including expected build growth");
			if (registry.records.some((item) => item.name === name))
				throw new Error(`worktree name already exists; use restore or another name: ${name}`);
			const repository = canonical(git(root, "rev-parse", "--show-toplevel").trim());
			const path = join(repository, ".worktrees", name);
			mkdirSync(dirname(path), { recursive: true });
			if (existsSync(path)) throw new Error(`refusing to adopt an existing checkout: ${path}`);
			this.admit(registry, reserve, dirname(path));
			const record: WorktreeRecord = { id: randomUUID(), name, repository, path, reserve, phase: "creating" };
			registry.records.push(record);
			save(join(this.home, "registry.json"), registry); // Reservation survives a crash in git.
			try {
				git(
					repository,
					"worktree",
					"add",
					"--detach",
					"--lock",
					"--reason",
					`quest worktree ${record.id}`,
					path,
					ref,
				);
				record.phase = "active";
				return record;
			} catch (error) {
				record.failure = String(error);
				throw error;
			}
		});
	}
	/** Refuses unless this record exclusively owns the checkout; false once Git and the disk both lack it. */
	private owned(record: WorktreeRecord): boolean {
		const path = canonical(record.path);
		const registered = checkouts(record.repository).find((entry) => entry.path === path);
		if (!registered && !existsSync(path)) return false;
		// Canonical paths follow a replaced root to its target, so ask the checkout on disk for its lock.
		const lock = existsSync(path) ? lockReason(record.path) : registered?.locked;
		if (lock !== `quest worktree ${record.id}`)
			throw new Error(
				"checkout ownership/lock changed; use the owning tool, never adopt or remove a shared checkout",
			);
		return true;
	}
	/**
	 * Deletes only the declared scratch, which Git must ignore and which holds no tracked files.
	 * The checkout, its Git state, and untracked source stay in place. A checkout that Git and the
	 * disk both lack, such as one removed with `git worktree remove`, drops its record instead.
	 */
	release(id: string, scratch: string[]): WorktreeRecord {
		return this.locked((registry) => {
			const record = this.find(registry, id);
			if (!this.owned(record)) {
				registry.records.splice(registry.records.indexOf(record), 1);
				return record;
			}
			if (record.phase === "creating")
				throw new Error(
					`creation was interrupted; inspect and remove the partial checkout with git worktree remove, then release again: ${record.path}`,
				);
			const root = canonical(record.path);
			const paths = scratch.map(childPath).filter((path) => present(root, path)); // Reruns skip pruned paths.
			const admin = entry(join(root, ".git"));
			for (const path of paths) {
				// Case folding and other platform aliases can still name the checkout's .git entry.
				const stat = entry(join(root, path));
				if (admin && stat?.dev === admin.dev && stat.ino === admin.ino)
					throw new Error(`scratch path is the checkout's .git entry: ${path}`);
			}
			if (paths.length) {
				const tracked = git(root, "--literal-pathspecs", "ls-files", "-z", "--", ...paths)
					.split("\0")
					.filter(Boolean);
				if (tracked.length)
					throw new Error(`scratch includes tracked files: ${tracked.slice(0, 20).join(", ")}`);
				const matched = ignored(root, paths);
				const unignored = paths.filter((path) => !matched.has(path));
				if (unignored.length) throw new Error(`scratch must be ignored by Git: ${unignored.join(", ")}`);
				// Removal unlinks symlinks rather than following them; force skips paths an overlapping parent removed.
				for (const path of paths) rmSync(join(root, path), { recursive: true, force: true });
			}
			record.phase = "released";
			return record;
		});
	}
	/** Reserves the released checkout's disk again; the caller then reinstalls or rebuilds its scratch. */
	restore(id: string): WorktreeRecord {
		return this.locked((registry) => {
			const record = this.find(registry, id);
			if (!this.owned(record)) throw new Error(`checkout is missing; release drops its record: ${record.path}`);
			if (record.phase === "active") return record;
			if (record.phase !== "released") throw new Error(`cannot restore a ${record.phase} checkout`);
			this.admit(registry, Math.max(0, record.reserve - diskUsage(record.path)), dirname(record.path));
			record.phase = "active";
			return record;
		});
	}
}
