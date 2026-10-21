// Host-wide command admission, sized from the host itself: every platform waits
// for CPU load and free memory before starting the command. The gate owns no
// descendants and holds nothing while the command runs.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, constants, cpus, homedir, hostname, loadavg, totalmem } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
	/** The highest 1-minute load average that still admits a command. */
	load: number;
	/** The least available memory, in bytes, that still admits a command. */
	memory: number;
}

export type Waiting = "load" | "memory";

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
 * Derive the limits from the host: no configuration. The load average counts
 * runnable threads on every CPU, including ones outside this process's
 * affinity, so its limit is one per host CPU. Each admission reserves one
 * command's memory, though never more than a quarter of a small host's RAM.
 */
export function hostLimits(
	processors = Math.max(availableParallelism(), cpus().length),
	memory = usableMemory(),
): Limits {
	return {
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
		const root = resolve(cgroups, unified ? "" : "memory");
		const usage = unified ? "memory.current" : "memory.usage_in_bytes";
		// Usage includes inactive file cache, which the kernel reclaims without
		// swapping; subtract it, as container runtimes do for their working set.
		const cache = unified ? "inactive_file" : "total_inactive_file";
		const limits = unified
			? ["memory.max", "memory.high"]
			: ["memory.limit_in_bytes", "memory.soft_limit_in_bytes"];
		// Child cgroups inherit their parents' limits and shared memory usage. The
		// walk ends at the mount point, which a container without a cgroup
		// namespace bind-mounts from its own cgroup: its membership path may not
		// exist below the mount, but the container's limit still applies there.
		const start = resolve(root, `.${path}`);
		// A cgroup namespace shows a cgroup outside it as `/..`, which is not mounted.
		const inside = relative(root, start);
		if (inside === ".." || inside.startsWith(`..${sep}`)) continue;
		for (let group = start; ; group = dirname(group)) {
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

/**
 * Wait until the host has room for a command and this caller wins the current
 * window. No fairness promise, adaptive scheduler, or admission timeout.
 */
export async function admit(limits: Limits, host: Host, signal: AbortSignal, waiting?: (reason: Waiting) => void) {
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

/** Marks an admitted command, so nested gated calls inside it run at once. */
const ADMITTED = "QUEST_GATE_ADMITTED";

/** Run a command in place, with inherited streams and its exact exit status. */
export function run(command: string[], signal: AbortSignal): Promise<number> {
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

const notices: Record<Waiting, string> = {
	load: "quest gate: waiting for the load average to fall",
	memory: "quest gate: waiting for free memory",
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
		// A nested invocation executes inside the already admitted command.
		if (process.env[ADMITTED] !== "1") {
			const shown = new Set<Waiting>();
			await admit(hostLimits(), fileHost(claimDirectory()), controller.signal, (reason) => {
				if (shown.has(reason)) return;
				shown.add(reason);
				process.stderr.write(`${notices[reason]}\n`);
			});
		}
		const result = await run(command, controller.signal);
		return interrupted || result;
	} catch (error) {
		if (interrupted) return interrupted;
		throw error;
	} finally {
		for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
	}
}
