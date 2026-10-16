// Recoverable Git checkouts. Recovery data is private, local, and never pushed.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statfsSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WorktreeRecord {
	id: string;
	name: string;
	repository: string;
	path: string;
	reserve: number;
	phase: "creating" | "active" | "releasing" | "released" | "restoring";
	checkpoint?: string;
	failure?: string;
}
interface Registry {
	version: 1;
	capacity: number;
	records: WorktreeRecord[];
}
interface RepositorySnapshot {
	path: string;
	head: string;
	branch: string | null;
	files: string[];
	missing: string[];
}
interface Snapshot {
	version: 1;
	created: string;
	notes: string;
	checks: string[];
	keep: string[];
	scratch: string[];
	repositories: RepositorySnapshot[];
	unclassified: string[];
}
export interface CheckpointOptions {
	notes: string;
	checks: string[];
	keep: string[];
	scratch: string[];
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}
function json<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
function save(path: string, value: unknown): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
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
function inside(root: string, path: string): boolean {
	const value = relative(root, path);
	return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}
function childPath(path: string): string {
	if (
		!path ||
		isAbsolute(path) ||
		path.split(/[\\/]/).some((part) => part === ".." || part === ".git") ||
		resolve("/", path) === "/"
	) {
		throw new Error(`expected a relative path without .. or .git: ${path}`);
	}
	return path.replaceAll("\\", "/").replace(/\/$/, "");
}
function covers(paths: string[], path: string): boolean {
	return paths.some((p) => path === p || path.startsWith(`${p}/`));
}
function list(root: string, ...args: string[]): string[] {
	return git(root, "ls-files", "-z", ...args)
		.split("\0")
		.filter(Boolean);
}

/** Allocated blocks, including ignored build output; symlinks are never traversed. */
export function diskUsage(path: string): number {
	if (!existsSync(path)) return 0;
	const stat = lstatSync(path);
	let bytes = Math.max(stat.blocks * 512, stat.size);
	if (stat.isDirectory()) for (const entry of readdirSync(path)) bytes += diskUsage(join(path, entry));
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
			const registry = existsSync(file)
				? json<Registry>(file)
				: { version: 1 as const, capacity: 0, records: [] };
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
	private measure(registry: Registry): number {
		const retained = diskUsage(join(this.home, "checkpoints"));
		return (
			retained +
			registry.records.reduce((total, record) => {
				if (record.phase === "released") return total;
				const checkout = diskUsage(record.path);
				const recovery = diskUsage(join(this.home, "checkpoints", record.id));
				return total + checkout + Math.max(0, record.reserve - checkout - recovery);
			}, 0)
		);
	}
	private admit(registry: Registry, reserve: number, root: string): void {
		if (lstatSync(this.home).dev !== lstatSync(root).dev)
			throw new Error(
				"worktree state and checkout must share a filesystem for disk admission; set QUEST_WORKTREE_HOME on the checkout filesystem",
			);
		const used = this.measure(registry);
		if (used + reserve > registry.capacity)
			throw new Error(
				`disk capacity exceeded: ${used} reserved/retained + ${reserve} requested > ${registry.capacity}`,
			);
		const fs = statfsSync(root);
		const future = registry.records.reduce(
			(total, record) =>
				total +
				(record.phase === "released"
					? 0
					: Math.max(
							0,
							record.reserve -
								diskUsage(record.path) -
								diskUsage(join(this.home, "checkpoints", record.id)),
						)),
			0,
		);
		if (Number(fs.bavail) * Number(fs.bsize) < future + reserve)
			throw new Error("insufficient free space after accounting for concurrent build reservations");
	}
	/** Capacity persists; reducing it below retained allocations is rejected. */
	configure(capacity: number): void {
		this.locked((registry) => {
			if (!Number.isSafeInteger(capacity) || capacity <= 0)
				throw new Error("capacity must be a positive safe integer in bytes");
			if (this.measure(registry) > capacity)
				throw new Error("capacity is below existing reserved/retained allocations");
			registry.capacity = capacity;
		});
	}
	status(): { capacity: number; allocated: number; retained: number; records: WorktreeRecord[] } {
		return this.locked((registry) => ({
			capacity: registry.capacity,
			allocated: this.measure(registry),
			retained: diskUsage(join(this.home, "checkpoints")),
			records: registry.records,
		}));
	}
	create(root: string, name: string, reserve: number, ref = "HEAD"): WorktreeRecord {
		return this.locked((registry) => {
			if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
				throw new Error("name must contain only letters, digits, dots, underscores, or hyphens");
			if (!Number.isSafeInteger(reserve) || reserve <= 0)
				throw new Error(
					"reserve must be a positive safe integer in bytes, including expected build and checkpoint growth",
				);
			if (registry.records.some((item) => item.name === name))
				throw new Error(`worktree name already exists; use restore or another name: ${name}`);
			const repository = canonical(git(root, "rev-parse", "--show-toplevel").trim());
			if (inside(repository, this.home))
				throw new Error("recovery state must live outside the disposable checkout");
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
		if (inside(path, canonical(process.cwd())))
			throw new Error("leave the checkout before checkpointing or releasing it");
		const entries = checkouts(record.repository);
		for (const entry of entries)
			if (entry.path !== path && inside(path, entry.path))
				throw new Error(`nested checkout is retained: ${entry.path}`);
		const entry = entries.find((entry) => entry.path === path);
		if (!entry && !existsSync(path)) return false;
		if (entry?.locked !== `quest worktree ${record.id}`)
			throw new Error(
				"checkout ownership/lock changed; use the owning tool, never adopt or remove a shared checkout",
			);
		return true;
	}
	/** Git removes the owned checkout and its administrative directory, even when the checkout is missing. */
	private discard(record: WorktreeRecord): void {
		if (!this.owned(record)) return;
		git(record.repository, "worktree", "remove", "--force", "--force", record.path);
		if (existsSync(record.path)) throw new Error("Git reported cleanup success but checkout is retained");
	}
	checkpoint(id: string, options: CheckpointOptions): WorktreeRecord {
		return this.locked((registry) => this.checkpointLocked(this.find(registry, id), options));
	}
	private checkpointLocked(record: WorktreeRecord, options: CheckpointOptions): WorktreeRecord {
		if (record.phase !== "active") throw new Error(`cannot checkpoint a ${record.phase} checkout`);
		if (!this.owned(record)) throw new Error(`active checkout is missing: ${record.path}`);
		if (!options.notes.trim())
			throw new Error("checkpoint notes must describe unresolved work, or state that it is complete");
		const keep = options.keep.map(childPath);
		const scratch = options.scratch.map(childPath);
		if (keep.some((k) => scratch.some((s) => covers([k], s) || covers([s], k))))
			throw new Error("keep and scratch paths overlap");
		const directory = join(this.home, "checkpoints", record.id, randomUUID());
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const snapshot: Snapshot = {
			version: 1,
			created: new Date().toISOString(),
			notes: options.notes,
			checks: options.checks,
			keep,
			scratch,
			repositories: [],
			unclassified: [],
		};
		try {
			const visit = (path: string) => {
				const root = join(record.path, path);
				const number = snapshot.repositories.length;
				const target = join(directory, String(number));
				mkdirSync(join(target, "files"), { recursive: true });
				const entries = list(root, "--stage").map((entry) => {
					const tab = entry.indexOf("\t");
					return { mode: entry.slice(0, 6), path: entry.slice(tab + 1) };
				});
				if (entries.some((entry) => !entry.path || entry.path.includes("\0")))
					throw new Error("invalid tracked path");
				if (git(root, "ls-files", "--unmerged").trim())
					throw new Error("resolve the unmerged index before checkpointing");
				const committed = git(root, "ls-tree", "-r", "-z", "HEAD")
					.split("\0")
					.filter(Boolean)
					.map((entry) => ({ mode: entry.slice(0, 6), path: entry.slice(entry.indexOf("\t") + 1) }));
				const files = [
					...new Set(
						[...entries, ...committed]
							.filter((entry) => entry.mode !== "160000")
							.map((entry) => entry.path),
					),
				];
				for (const file of files)
					if (covers(scratch, path ? `${path}/${file}` : file))
						throw new Error(`scratch includes tracked source: ${file}`);
				const missing: string[] = [];
				for (const file of files) {
					const source = join(root, file);
					try {
						lstatSync(source);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") {
							missing.push(file);
							continue;
						}
						throw error;
					}
					mkdirSync(dirname(join(target, "files", file)), { recursive: true });
					cpSync(source, join(target, "files", file), { dereference: false });
				}
				let branch: string | null = null;
				try {
					branch = git(root, "symbolic-ref", "--quiet", "HEAD").trim();
				} catch {
					/* Detached HEAD is supported. */
				}
				const head = git(root, "rev-parse", "HEAD").trim();
				const index = git(root, "rev-parse", "--path-format=absolute", "--git-path", "index").trim();
				cpSync(index, join(target, "index"));
				if (path) {
					const config = git(root, "rev-parse", "--path-format=absolute", "--git-path", "config").trim();
					cpSync(config, join(target, "config"));
				}
				// A recovery commit makes staged blobs reachable without changing HEAD/index.
				const tree = git(root, "write-tree").trim();
				const commit = git(
					root,
					"-c",
					"user.name=Quest recovery",
					"-c",
					"user.email=recovery@localhost",
					"commit-tree",
					tree,
					"-p",
					head,
					"-m",
					`Local worktree recovery ${record.id}`,
				).trim();
				git(root, "update-ref", `refs/quest/worktrees/${record.id}/${number}`, commit);
				git(root, "bundle", "create", join(target, "history.bundle"), "--all", "--reflog", "HEAD");
				git(root, "bundle", "verify", join(target, "history.bundle"));
				snapshot.repositories.push({ path, head, branch, files, missing });
				for (const file of [
					...list(root, "--others", "--exclude-standard"),
					...list(root, "--others", "--ignored", "--exclude-standard"),
				]) {
					const relative = path ? `${path}/${file}` : file;
					if (!covers(keep, relative) && !covers(scratch, relative)) snapshot.unclassified.push(relative);
				}
				for (const entry of [
					...new Map(
						[...entries, ...committed]
							.filter((entry) => entry.mode === "160000")
							.map((entry) => [entry.path, entry]),
					).values(),
				]) {
					const child = path ? `${path}/${entry.path}` : entry.path;
					if (existsSync(join(record.path, child, ".git"))) visit(child);
					else if (existsSync(join(record.path, child)) && readdirSync(join(record.path, child)).length)
						throw new Error(`unrecognized submodule contents: ${child}`);
				}
			};
			visit("");
			for (const path of keep) {
				const source = join(record.path, path);
				if (!existsSync(source)) throw new Error(`keep path does not exist: ${path}`);
				if (!inside(record.path, realpathSync(source))) throw new Error(`keep path escapes checkout: ${path}`);
				if (lstatSync(source).isDirectory() && existsSync(join(source, ".git")))
					throw new Error(
						`keep directories cannot contain a repository: ${path}; tracked submodules are preserved automatically`,
					);
				mkdirSync(dirname(join(directory, "kept", path)), { recursive: true });
				cpSync(source, join(directory, "kept", path), { recursive: true, dereference: false });
			}
			save(join(directory, "snapshot.json"), snapshot);
			const previous = record.checkpoint;
			record.checkpoint = directory;
			record.failure = undefined;
			// Publish the new recovery pointer before collecting the old checkpoint.
			// A crash can retain extra data, but can never invalidate the saved pointer.
			const registry = json<Registry>(join(this.home, "registry.json"));
			const current = this.find(registry, record.id);
			Object.assign(current, record);
			save(join(this.home, "registry.json"), registry);
			if (previous) rmSync(previous, { recursive: true });
			return record;
		} catch (error) {
			if (record.checkpoint !== directory) rmSync(directory, { recursive: true });
			throw error;
		}
	}
	/** Checkpoint and deletion occur under the same lock; stale snapshots cannot lose edits. */
	release(id: string, options: CheckpointOptions): WorktreeRecord {
		return this.locked((registry) => {
			const record = this.find(registry, id);
			if (record.phase === "released") return record;
			if (record.phase === "active") {
				this.checkpointLocked(record, options);
				const snapshot = json<Snapshot>(join(record.checkpoint!, "snapshot.json"));
				if (snapshot.unclassified.length)
					throw new Error(
						`classify untracked/ignored files with --keep or --scratch before release: ${snapshot.unclassified.slice(0, 20).join(", ")}`,
					);
				record.phase = "releasing";
				save(join(this.home, "registry.json"), registry);
			}
			// An interrupted create, restore, or release never handed out new work, so the last
			// checkpoint stays authoritative; checkpointing a partial checkout could corrupt it.
			try {
				this.discard(record);
			} catch (error) {
				record.failure = String(error);
				throw new Error(`cleanup failed; allocation retained: ${record.path}: ${String(error)}`);
			}
			record.phase = "released";
			record.failure = undefined;
			// An abandoned creation has nothing to restore; free its name and reservation.
			if (!record.checkpoint) registry.records.splice(registry.records.indexOf(record), 1);
			return record;
		});
	}
	restore(id: string): WorktreeRecord {
		return this.locked((registry) => {
			const record = this.find(registry, id);
			if (record.phase === "active") {
				if (!this.owned(record)) throw new Error(`active checkout is missing: ${record.path}`);
				return record;
			}
			if (record.phase === "restoring") {
				// Retry an interrupted restore from the untouched checkpoint.
				this.discard(record);
				record.phase = "released";
			}
			if (record.phase !== "released" || !record.checkpoint)
				throw new Error(`cannot restore a ${record.phase} allocation; release finishes or abandons it`);
			if (existsSync(record.path))
				throw new Error("restore destination exists; refusing to adopt or overwrite it");
			this.admit(registry, record.reserve, dirname(record.path));
			const snapshot = json<Snapshot>(join(record.checkpoint, "snapshot.json"));
			if (snapshot.version !== 1) throw new Error("unsupported checkpoint version");
			record.phase = "restoring";
			save(join(this.home, "registry.json"), registry);
			try {
				for (let i = 0; i < snapshot.repositories.length; i++) {
					const saved = snapshot.repositories[i];
					const root = join(record.path, saved.path);
					const source = join(record.checkpoint, String(i));
					if (i === 0) {
						git(
							record.repository,
							"fetch",
							"--no-write-fetch-head",
							join(source, "history.bundle"),
							`refs/quest/worktrees/${record.id}/0:refs/quest/worktrees/${record.id}/0`,
						);
						git(
							record.repository,
							"worktree",
							"add",
							"--detach",
							"--lock",
							"--reason",
							`quest worktree ${record.id}`,
							root,
							saved.head,
						);
					} else {
						mkdirSync(root, { recursive: true });
						git(root, "init");
						cpSync(join(source, "config"), join(root, ".git", "config"));
						// Embedded restored gitdirs have a different relative worktree path.
						try {
							execFileSync(
								"git",
								["config", "--file", join(root, ".git", "config"), "--unset-all", "core.worktree"],
								{ cwd: this.home, stdio: "pipe" },
							);
						} catch (error) {
							if ((error as { status?: number }).status !== 5) throw error;
						}
						git(root, "fetch", "--no-write-fetch-head", join(source, "history.bundle"), "+refs/*:refs/*");
						git(root, "checkout", "--detach", saved.head);
					}
					// The main checkout stays detached so a moved, deleted, or checked-out branch never blocks
					// restore; submodule gitdirs are private copies, so their branches return as saved.
					if (saved.branch && i > 0) git(root, "symbolic-ref", "HEAD", saved.branch);
					for (const file of saved.missing) rmSync(join(root, file), { force: true });
					for (const file of saved.files.filter((file) => !saved.missing.includes(file))) {
						mkdirSync(dirname(join(root, file)), { recursive: true });
						rmSync(join(root, file), { force: true });
						cpSync(join(source, "files", file), join(root, file), { dereference: false });
					}
					cpSync(
						join(source, "index"),
						git(root, "rev-parse", "--path-format=absolute", "--git-path", "index").trim(),
					);
				}
				if (existsSync(join(record.checkpoint, "kept")))
					cpSync(join(record.checkpoint, "kept"), record.path, { recursive: true, dereference: false });
				record.phase = "active";
				record.failure = undefined;
				return record;
			} catch (error) {
				record.failure = String(error);
				throw new Error(
					`restore incomplete; allocation and recovery retained: ${record.path}: ${String(error)}`,
				);
			}
		});
	}
}
