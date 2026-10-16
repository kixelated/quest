// Host-wide command admission. Every platform waits for the load average; on
// Linux, systemd scope slots also cap concurrency and own orphans' lifetimes.
import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	watch,
	writeSync,
} from "node:fs";
import { availableParallelism, constants, homedir, loadavg } from "node:os";
import { join } from "node:path";
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
}

export type Waiting = "load" | "slots";

/**
 * At most one admission per window across all callers. The load average lags
 * new work, so waiters that all see it fall must not start together.
 */
export const SETTLE_MS = 5000;

export function gateLimits(config: unknown, cores = availableParallelism()): Limits {
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error("gate configuration must be an object");
	}
	const { jobs = cores, load = cores } = config as { jobs?: unknown; load?: unknown };
	if (typeof jobs !== "number" || !Number.isSafeInteger(jobs) || jobs < 1) {
		throw new Error("gate jobs must be a positive safe integer");
	}
	if (typeof load !== "number" || !Number.isFinite(load) || load <= 0) {
		throw new Error("gate load must be a positive number");
	}
	return { jobs, load };
}

/** Claims are empty files, named by window, in one per-user directory. */
export function fileHost(directory: string): Host {
	return {
		load: () => loadavg()[0],
		now: Date.now,
		claim(window) {
			mkdirSync(directory, { recursive: true });
			try {
				closeSync(openSync(join(directory, String(window)), "wx"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
				throw error;
			}
			for (const name of readdirSync(directory)) {
				if (Number(name) < window) rmSync(join(directory, name), { force: true });
			}
			return true;
		},
		sleep: (ms, signal) => sleep(ms, undefined, { signal }),
	};
}

/** Wait until the load admits a command and this caller wins the current window. */
async function settle(host: Host, limit: number, signal: AbortSignal, waiting?: (reason: Waiting) => void) {
	for (;;) {
		signal.throwIfAborted();
		const now = host.now();
		const window = Math.floor(now / SETTLE_MS);
		if (host.load() > limit) waiting?.("load");
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
		await settle(host, limits.load, signal, waiting);
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
const handshake = "cat /proc/self/cgroup >&4 || exit 125; read -r admitted <&5 || exit 125; exec 4>&- 5<&-; ";
const forward =
	'if [ "$1" = set ]; then export LC_ALL="$2"; else unset LC_ALL; fi; ' + 'shift 2; exec 2>&3 3>&-; exec "$@"';

interface Result {
	code: number;
	stderr: string;
	stdout: string;
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
					const path = cgroup.trim().match(/^0::(\/[^\n]+)$/)?.[1];
					if (!path || !path.endsWith(`/${scope}`))
						throw new Error("gate requires unified cgroup v2 ownership");
					killHandle = openSync(join("/sys/fs/cgroup", path, "cgroup.kill"), "w");
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
				handshake + forward,
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
			["--user", "show", "--property=FragmentPath", "--property=ControlGroup", unit(slot)],
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
		// A unit file would make every transient claim on this slot fail.
		if (properties.get("FragmentPath"))
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
			try {
				const path = join("/sys/fs/cgroup", cgroup, "cgroup.events");
				watcher = watch(path, (event) => {
					// Wait for the kernel cgroup to be removed, not merely empty:
					// an empty scope may still be awaiting systemd collection.
					if (event === "rename") finish();
				});
				watcher.on("error", finish);
				signal.addEventListener("abort", aborted, { once: true });
				if (signal.aborted) aborted();
				// Registration precedes the read, covering deletion during setup.
				readFileSync(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") finish();
				else finish(error);
			}
		});
	}
}

/** A user manager on unified cgroups provides exact slot ownership. */
function systemd(): boolean {
	const runtime = process.env.XDG_RUNTIME_DIR;
	return (
		process.platform === "linux" &&
		runtime !== undefined &&
		existsSync(join(runtime, "systemd", "private")) &&
		existsSync("/sys/fs/cgroup/cgroup.controllers")
	);
}

const notices: Record<Waiting, string> = {
	load: "quest gate: waiting for the load average to fall",
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
		const backend = systemd() ? new SystemdGate() : new DirectGate();
		// A nested invocation executes inside the already admitted command.
		if (backend.nested()) {
			const result = await run(command, controller.signal);
			return interrupted || result;
		}
		let config: unknown = {};
		try {
			config = JSON.parse(readFileSync(join(homedir(), ".config", "quest", "gate.json"), "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const shown = new Set<Waiting>();
		const result = await admit(
			command,
			gateLimits(config),
			backend,
			fileHost(join(homedir(), ".cache", "quest", "gate")),
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
