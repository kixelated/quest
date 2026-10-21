// Host-wide command admission, sized from the host itself. Every platform waits
// for CPU load and free memory; on Linux, systemd scope slots also cap
// concurrency and own orphans' lifetimes.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	watch,
	writeSync,
} from "node:fs";
import { availableParallelism, constants, cpus, homedir, hostname, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";

export interface GateBackend {
	/** True when this process already runs inside an admitted command. */
	nested(): boolean;
	/** null means the atomic slot claim lost to another caller. */
	tryRun(slot: number, command: string[], signal: AbortSignal): Promise<number | null>;
	/** Block on a slot's lifecycle, rather than polling PID files. */
	wait(slot: number, signal: AbortSignal): Promise<void>;
}

/** The machine-wide inputs to load admission, replaceable in tests. */
export interface Host {
	/** The 1-minute load average. */
	load(): number;
	/** Bytes available to a new command without swapping. */
	memory(): number;
	now(): number;
	/** Atomically claim an admission window; false when another caller took it. */
	claim(window: number): boolean;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface Limits {
	/** Concurrent slots, where the platform can own them. */
	jobs: number;
	/** The highest 1-minute load average that still admits a command. */
	load: number;
	/** The least available memory, in bytes, that still admits a command. */
	memory: number;
}

export type Waiting = "load" | "memory" | "slots";

/**
 * At most one admission per window across all callers. The load average lags
 * new work, so waiters that all see it fall must not start together.
 */
export const SETTLE_MS = 5000;

/** The memory one gated build or test stack is assumed to need. */
export const COMMAND_MEMORY = 4 * 2 ** 30;

/** Usable memory: physical RAM, or a smaller cgroup/container limit. */
function usableMemory(): number {
	if (process.platform === "linux") return linuxMemory().total;
	const constrained = process.constrainedMemory?.() ?? 0;
	return constrained > 0 ? Math.min(totalmem(), constrained) : totalmem();
}

/**
 * Derive the limits from the host: no configuration. Slots never exceed the
 * cores this process may use. The load average counts runnable threads on every
 * CPU, including ones outside this process's affinity, so its limit is one per
 * host CPU. Each slot and each admission reserves one command's memory, though
 * never more than a quarter of a small host's RAM.
 */
export function hostLimits(
	cores = availableParallelism(),
	memory = usableMemory(),
	processors = Math.max(cores, cpus().length),
): Limits {
	return {
		jobs: Math.max(1, Math.min(cores, Math.floor(memory / COMMAND_MEMORY))),
		load: processors,
		memory: Math.min(COMMAND_MEMORY, memory / 4),
	};
}

/** A memory.stat counter, or 0 where the file or key is absent. */
function cgroupStat(group: string, key: string): number {
	try {
		const stat = readFileSync(join(group, "memory.stat"), "utf8");
		return Number(stat.match(new RegExp(`^${key} (\\d+)$`, "m"))?.[1] ?? 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
}

/** Count reclaimable host cache and the headroom of every enclosing memory cgroup. */
export function linuxMemory(proc = "/proc", cgroups = "/sys/fs/cgroup"): { total: number; available: number } {
	const meminfo = readFileSync(join(proc, "meminfo"), "utf8");
	const bytes = (key: string) => {
		const value = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, "m"))?.[1];
		if (value === undefined) throw new Error(`gate cannot read Linux ${key}`);
		return Number(value) * 1024;
	};
	let total = bytes("MemTotal");
	let available = bytes("MemAvailable");
	for (const line of readFileSync(join(proc, "self/cgroup"), "utf8").trim().split("\n")) {
		const [, controllers, path] = line.match(/^\d+:([^:]*):(.*)$/) ?? [];
		if (controllers === undefined || path === undefined) throw new Error("gate cannot read Linux memory cgroups");
		const unified = controllers === "";
		if (!unified && !controllers?.split(",").includes("memory")) continue;
		const root = unified ? cgroups : join(cgroups, "memory");
		const usage = unified ? "memory.current" : "memory.usage_in_bytes";
		// Usage includes inactive file cache, which the kernel reclaims without
		// swapping; subtract it, as container runtimes do for their working set.
		const cache = unified ? "inactive_file" : "total_inactive_file";
		const limits = unified
			? ["memory.max", "memory.high"]
			: ["memory.limit_in_bytes", "memory.soft_limit_in_bytes"];
		// Child cgroups inherit their parents' limits and shared memory usage.
		for (let group = join(root, path); ; group = dirname(group)) {
			for (const file of limits) {
				try {
					const limit = Number(readFileSync(join(group, file), "utf8").trim());
					if (!Number.isFinite(limit) || limit <= 0) continue; // "max", or an unset v1 soft limit.
					const current = Number(readFileSync(join(group, usage), "utf8").trim());
					if (!Number.isFinite(current) || current < 0)
						throw new Error("gate cannot read Linux cgroup memory usage");
					const used = Math.max(0, current - cgroupStat(group, cache));
					total = Math.min(total, limit);
					available = Math.min(available, Math.max(0, limit - used));
				} catch (error) {
					// The memory controller may not be enabled in every ancestor.
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
			if (group === root || group === dirname(group)) break;
		}
	}
	return { total, available };
}

/**
 * Claims belong to this host, since a home directory may be shared between
 * machines: the user's runtime directory where one exists, otherwise a
 * per-host cache directory.
 */
export function claimDirectory(env = process.env, home = homedir(), host = hostname()): string {
	return env.XDG_RUNTIME_DIR
		? join(env.XDG_RUNTIME_DIR, "quest", "gate")
		: join(home, ".cache", "quest", "gate", host);
}

/** Claims are empty files, named by window, in one per-user, per-host directory. */
export function fileHost(directory: string, now = Date.now): Host {
	return {
		load: () => loadavg()[0],
		// macOS counts reclaimable cache as used, so only its load is gated.
		memory: () =>
			process.platform === "darwin"
				? Infinity
				: process.platform === "linux"
					? linuxMemory().available
					: process.availableMemory(),
		now,
		claim(window) {
			if (window !== Math.floor(now() / SETTLE_MS)) return false;
			mkdirSync(directory, { recursive: true });
			try {
				closeSync(openSync(join(directory, String(window)), "wx"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
				throw error;
			}
			// A descheduled caller may have created an old claim after cleanup.
			// It must not admit work from that expired sample.
			if (window !== Math.floor(now() / SETTLE_MS)) return false;
			for (const name of readdirSync(directory)) {
				if (Number(name) < window) rmSync(join(directory, name), { force: true });
			}
			return true;
		},
		sleep: (ms, signal) => sleep(ms, undefined, { signal }),
	};
}

/** Wait until the host has room for a command and this caller wins the current window. */
async function settle(host: Host, limits: Limits, signal: AbortSignal, waiting?: (reason: Waiting) => void) {
	for (;;) {
		signal.throwIfAborted();
		const now = host.now();
		const window = Math.floor(now / SETTLE_MS);
		if (host.load() > limits.load) waiting?.("load");
		else if (host.memory() < limits.memory) waiting?.("memory");
		else if (host.claim(window)) return;
		// Waiters wake together at the boundary, and exactly one claims the window.
		await host.sleep((window + 1) * SETTLE_MS - now, signal);
	}
}

export async function admit(
	command: string[],
	limits: Limits,
	backend: GateBackend,
	host: Host,
	signal: AbortSignal,
	waiting?: (reason: Waiting) => void,
): Promise<number> {
	for (;;) {
		await settle(host, limits, signal, waiting);
		for (let slot = 0; slot < limits.jobs; slot++) {
			signal.throwIfAborted();
			const result = await backend.tryRun(slot, command, signal);
			if (result !== null) return result;
		}
		// Waiting on the first occupied slot is deliberately simple: no fairness
		// promise, adaptive scheduler, busy polling, or admission timeout.
		waiting?.("slots");
		await backend.wait(0, signal);
	}
}

/** Marks a command admitted by load alone, where no kernel scope can. */
const ADMITTED = "QUEST_GATE_ADMITTED";

/** Run a command in place, with inherited streams and its exact exit status. */
function run(command: string[], signal: AbortSignal): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command[0], command.slice(1), {
			env: { ...process.env, [ADMITTED]: "1" },
			stdio: "inherit",
		});
		const cancel = () => child.kill("SIGTERM");
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		child.once("error", (error) => {
			signal.removeEventListener("abort", cancel);
			reject(error);
		});
		child.once("close", (code, killed) => {
			signal.removeEventListener("abort", cancel);
			resolve(code ?? (killed ? 128 + constants.signals[killed] : 1));
		});
	});
}

/** Load-only admission, where the platform cannot own descendants exactly. */
export class DirectGate implements GateBackend {
	nested(): boolean {
		return process.env[ADMITTED] === "1";
	}

	tryRun(_slot: number, command: string[], signal: AbortSignal): Promise<number> {
		return run(command, signal);
	}

	wait(): Promise<void> {
		return Promise.reject(new Error("load-only admission has no slots to wait on"));
	}
}

const unit = (slot: number) => `quest-gate-${slot}.scope`;
const scopePattern = /(?:^|\/)quest-gate-\d+\.scope(?:\/|$)/;

/** No shell parses the command. This shell only restores stderr and locale. */
export const scopeHandshake =
	"IFS=: read -r hierarchy controllers path </proc/self/cgroup || exit 125; " +
	'[ "$hierarchy:$controllers" = 0: ] || exit 125; ' +
	'exec 7>"/sys/fs/cgroup$path/cgroup.kill" || exit 125; ' +
	'while read -r key value; do if [ "$key" = ino: ]; then inode=$value; fi; done </proc/self/fdinfo/7; ' +
	'[ -n "$inode" ] || exit 125; printf "%s\\t%s\\n" "$path" "$inode" >&4; ' +
	"read -r admitted <&5 || exit 125; exec 4>&- 5<&- 7>&-; ";
const forward =
	'if [ "$1" = set ]; then export LC_ALL="$2"; else unset LC_ALL; fi; ' + 'shift 2; exec 2>&3 3>&-; exec "$@"';

interface Result {
	code: number;
	stderr: string;
	stdout: string;
}

/** Validate the shell's kernel identity before this handle can be used to cancel. */
export function openOwnership(path: string, inode: bigint): number {
	const handle = openSync(path, fsConstants.O_WRONLY);
	try {
		if (fstatSync(handle, { bigint: true }).ino !== inode) throw new Error("gate scope exited before admission");
		return handle;
	} catch (error) {
		closeSync(handle);
		throw error;
	}
}

function execute(
	command: string,
	args: string[],
	signal: AbortSignal,
	/** The scope that runs the command with the caller's streams. */
	scope?: string,
): Promise<Result> {
	return new Promise((resolve, reject) => {
		// Set up the stderr channels in the child shell, before replacing fd 2.
		// Numeric fd 2 in Bun's extra stdio would duplicate the new diagnostic
		// pipe. Reopening /proc/self/fd/2 also fails for socket-backed streams.
		const child = spawn(
			scope ? "/bin/sh" : command,
			scope ? ["-c", 'exec 6>&2; exec 2>&3; exec 3>&6 6>&-; exec "$@"', "quest-gate", command, ...args] : args,
			{
				env: { ...process.env, LC_ALL: "C" },
				stdio: scope ? ["inherit", "inherit", "inherit", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
			},
		);
		let stderr = "";
		let stdout = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (data: string) => (stdout += data));
		const diagnostics = scope ? (child.stdio[3] as Readable) : child.stderr;
		diagnostics?.setEncoding("utf8");
		diagnostics?.on("data", (data: string) => (stderr += data));
		let killHandle: number | undefined;
		let ownershipError: Error | undefined;
		const cancel = () => {
			if (killHandle !== undefined) {
				// The open kernel handle pins this exact cgroup. A reusable unit
				// name (or PID) must never target a later command after an exit race.
				try {
					writeSync(killHandle, "1");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENODEV") ownershipError = error as Error;
				}
			} else child.kill("SIGTERM");
		};
		if (scope) {
			const ownership = child.stdio[4];
			let cgroup = "";
			ownership?.on("data", (data: Buffer) => {
				cgroup += data.toString();
				if (!cgroup.endsWith("\n")) return;
				try {
					const identity = cgroup.match(/^(\/[^\t\n]+)\t(\d+)\n$/);
					const path = identity?.[1];
					if (!path || !path.endsWith(`/${scope}`))
						throw new Error("gate requires unified cgroup v2 ownership");
					// The slot path can already name a successor if the shell died.
					// Linux kernfs inodes include the generation on 64-bit hosts.
					killHandle = openOwnership(join("/sys/fs/cgroup", path, "cgroup.kill"), BigInt(identity![2]));
					if (signal.aborted) cancel();
					else {
						const admission = (child.stdio as unknown as (Writable | null)[])[5];
						admission?.on("error", (error: NodeJS.ErrnoException) => {
							if (error.code !== "EPIPE") ownershipError = error;
						});
						admission?.end("admitted\n");
					}
				} catch (error) {
					ownershipError = new Error(
						`gate ownership unavailable: ${error instanceof Error ? error.message : error}`,
					);
					child.kill("SIGKILL");
				}
			});
		}

		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		child.once("error", (error) => {
			signal.removeEventListener("abort", cancel);
			reject(error);
		});
		child.once("close", async (code, killed) => {
			signal.removeEventListener("abort", cancel);
			try {
				if (killHandle !== undefined) closeSync(killHandle);
				if (ownershipError) throw ownershipError;
				resolve({ code: code ?? (killed ? 128 + constants.signals[killed] : 1), stderr, stdout });
			} catch (error) {
				reject(error);
			}
		});
	});
}

export class SystemdGate implements GateBackend {
	/** The kernel scope, never an inherited environment claim. */
	nested(): boolean {
		return scopePattern.test(readFileSync("/proc/self/cgroup", "utf8").trim());
	}

	async tryRun(slot: number, command: string[], signal: AbortSignal): Promise<number | null> {
		const name = unit(slot);
		return this.runScope(name, command, signal);
	}

	async runScope(name: string, command: string[], signal: AbortSignal): Promise<number | null> {
		const result = await execute(
			"systemd-run",
			[
				"--user",
				"--scope",
				"--quiet",
				"--collect",
				`--unit=${name}`,
				"--expand-environment=no",
				"--",
				"/bin/sh",
				"-c",
				scopeHandshake + forward,
				"quest-gate",
				process.env.LC_ALL === undefined ? "unset" : "set",
				process.env.LC_ALL ?? "",
				...command,
			],
			signal,
			name,
		);
		// Only systemd-run's own stderr reaches this pipe. The command's stderr
		// was restored to the original terminal/pipe through descriptor 3.
		if (
			result.code !== 0 &&
			(result.stderr.includes(`Unit ${name} already exists`) ||
				result.stderr.includes(`Unit ${name} was already loaded or has a fragment file`))
		)
			return null;
		if (result.stderr.trim()) throw new Error(`gate scope failed: ${result.stderr.trim()}`);
		return result.code;
	}

	async wait(slot: number, signal: AbortSignal): Promise<void> {
		const result = await execute(
			"systemctl",
			[
				"--user",
				"show",
				"--property=FragmentPath",
				"--property=Transient",
				"--property=ControlGroup",
				unit(slot),
			],
			signal,
		);
		signal.throwIfAborted();
		if (result.code !== 0) throw new Error(`gate wait failed: ${result.stderr.trim() || result.code}`);
		const properties = new Map(
			result.stdout
				.trim()
				.split("\n")
				.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
		);
		// A persistent unit file would make every transient claim on this slot
		// fail. A live occupant's own transient unit also reports a fragment.
		if (properties.get("FragmentPath") && properties.get("Transient") !== "yes")
			throw new Error(`gate slot is blocked by ${properties.get("FragmentPath")}; remove that unit file`);
		// The occupant already exited (or awaits collection): retry admission.
		const cgroup = properties.get("ControlGroup");
		if (!cgroup) return;
		await new Promise<void>((resolve, reject) => {
			let watcher: ReturnType<typeof watch> | undefined;
			const finish = (error?: unknown) => {
				watcher?.close();
				signal.removeEventListener("abort", aborted);
				if (error) reject(error);
				else resolve();
			};
			const aborted = () => finish(signal.reason);
			const path = join("/sys/fs/cgroup", cgroup, "cgroup.events");
			// The kernel notifies when the last process leaves, but not when the
			// cgroup is removed. An empty scope still awaiting systemd collection
			// makes the next claim lose, so admission waits here again.
			const vacated = () => {
				try {
					if (/^populated 0$/m.test(readFileSync(path, "utf8"))) finish();
				} catch (error) {
					// ENODEV: the cgroup was removed between open and read.
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "ENOENT" || code === "ENODEV") finish();
					else finish(error);
				}
			};
			try {
				watcher = watch(path, vacated);
				watcher.on("error", finish);
				signal.addEventListener("abort", aborted, { once: true });
				if (signal.aborted) aborted();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") return finish(error);
			}
			// Registration precedes the read, covering an exit during setup.
			vacated();
		});
	}
}

/** Probe without starting the user's command; unsupported hosts use direct admission. */
export async function systemd(signal: AbortSignal): Promise<boolean> {
	const runtime = process.env.XDG_RUNTIME_DIR;
	if (!(
		process.platform === "linux" &&
		runtime !== undefined &&
		existsSync(join(runtime, "systemd", "private")) &&
		existsSync("/sys/fs/cgroup/cgroup.controllers")
	))
		return false;
	try {
		const client = await execute("systemd-run", ["--version"], signal);
		if (client.code !== 0 || Number(client.stdout.match(/^systemd (\d+)/)?.[1] ?? 0) < 254) return false;
		const manager = await execute("systemctl", ["--user", "show", "--property=Version", "--value"], signal);
		if (manager.code !== 0 || Number(manager.stdout.match(/^(\d+)/)?.[1] ?? 0) < 254) return false;
		// This exercises the manager, kernel support, and actual scope permissions,
		// including opening cgroup.kill in both processes before the handshake.
		return (
			(await new SystemdGate().runScope(
				`quest-gate-probe-${randomUUID()}.scope`,
				["/bin/sh", "-c", ":"],
				signal,
			)) === 0
		);
	} catch {
		signal.throwIfAborted();
		return false;
	}
}

const notices: Record<Waiting, string> = {
	load: "quest gate: waiting for the load average to fall",
	memory: "quest gate: waiting for free memory",
	slots: "quest gate: waiting for a free slot",
};

/** Run from the CLI. */
export async function gate(command: string[]): Promise<number> {
	const controller = new AbortController();
	let interrupted = 0;
	const interrupt = (name: "SIGINT" | "SIGTERM" | "SIGHUP") => {
		interrupted = 128 + constants.signals[name];
		controller.abort();
	};
	const handlers = {
		SIGINT: () => interrupt("SIGINT"),
		SIGTERM: () => interrupt("SIGTERM"),
		SIGHUP: () => interrupt("SIGHUP"),
	};
	for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
	try {
		// Kernel ownership already proves admission; a nested call must not need
		// another manager probe (or fall back into host pressure admission).
		if (process.platform === "linux" && new SystemdGate().nested()) {
			return interrupted || (await run(command, controller.signal));
		}
		const backend = (await systemd(controller.signal)) ? new SystemdGate() : new DirectGate();
		// A nested invocation executes inside the already admitted command.
		if (backend.nested()) {
			const result = await run(command, controller.signal);
			return interrupted || result;
		}
		const shown = new Set<Waiting>();
		const result = await admit(
			command,
			hostLimits(),
			backend,
			fileHost(claimDirectory()),
			controller.signal,
			(reason) => {
				if (shown.has(reason)) return;
				shown.add(reason);
				process.stderr.write(`${notices[reason]}\n`);
			},
		);
		return interrupted || result;
	} catch (error) {
		if (interrupted) return interrupted;
		throw error;
	} finally {
		for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
	}
}
