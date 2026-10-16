// Host-wide command admission. systemd owns scope lifetimes, including orphans.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, watch, writeSync } from "node:fs";
import { availableParallelism, constants, homedir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

export interface GateBackend {
	/** null means the atomic scope claim lost to another caller. */
	tryRun(slot: number, command: string[], signal: AbortSignal): Promise<number | null>;
	/** Block on a unit's lifecycle, rather than polling PID files or load. */
	wait(slot: number, signal: AbortSignal): Promise<void>;
}

export function gateJobs(config: unknown, fallback = availableParallelism()): number {
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error("gate configuration must be an object with a jobs property");
	}
	const configured = (config as { jobs?: unknown }).jobs;
	const jobs = configured === undefined ? fallback : configured;
	if (typeof jobs !== "number" || !Number.isSafeInteger(jobs) || jobs < 1) {
		throw new Error("gate jobs must be a positive safe integer");
	}
	return jobs;
}

export async function admit(
	command: string[],
	jobs: number,
	backend: GateBackend,
	signal: AbortSignal,
): Promise<number> {
	for (;;) {
		signal.throwIfAborted();
		for (let slot = 0; slot < jobs; slot++) {
			signal.throwIfAborted();
			const result = await backend.tryRun(slot, command, signal);
			if (result !== null) return result;
		}
		// Waiting on the first occupied slot is deliberately simple: no fairness
		// promise, adaptive scheduler, busy polling, or admission timeout.
		await backend.wait(0, signal);
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
	options: { forward?: boolean; scope?: string } = {},
): Promise<Result> {
	return new Promise((resolve, reject) => {
		// Set up the stderr channels in the child shell, before replacing fd 2.
		// Numeric fd 2 in Bun's extra stdio would duplicate the new diagnostic
		// pipe. Reopening /proc/self/fd/2 also fails for socket-backed streams.
		const child = spawn(
			options.forward ? "/bin/sh" : command,
			options.forward
				? ["-c", 'exec 6>&2; exec 2>&3; exec 3>&6 6>&-; exec "$@"', "quest-gate", command, ...args]
				: args,
			{
				env: { ...process.env, LC_ALL: "C" },
				stdio: options.scope
					? ["inherit", "inherit", "inherit", "pipe", "pipe", "pipe"]
					: options.forward
						? ["inherit", "inherit", "inherit", "pipe"]
						: ["ignore", "pipe", "pipe"],
			},
		);
		let stderr = "";
		let stdout = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (data: string) => (stdout += data));
		const diagnostics = options.forward ? (child.stdio[3] as Readable) : child.stderr;
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
		if (options.scope) {
			const ownership = child.stdio[4];
			let cgroup = "";
			ownership?.on("data", (data: Buffer) => {
				cgroup += data.toString();
				if (!cgroup.endsWith("\n")) return;
				try {
					const path = cgroup.trim().match(/^0::(\/[^\n]+)$/)?.[1];
					if (!path || !path.endsWith(`/${options.scope}`))
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
			{ forward: true, scope: name },
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

/** Run from the CLI. Unsupported ownership must never silently run ungated. */
export async function gate(command: string[]): Promise<number> {
	if (process.platform !== "linux")
		throw new Error(
			"gate requires Linux with a systemd user manager; this platform's process ownership is unsupported",
		);
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
		const backend = new SystemdGate();
		if (backend.nested()) {
			// A nested invocation executes in the already admitted kernel scope.
			const result = await execute(
				"/bin/sh",
				[
					"-c",
					forward,
					"quest-gate",
					process.env.LC_ALL === undefined ? "unset" : "set",
					process.env.LC_ALL ?? "",
					...command,
				],
				controller.signal,
				{ forward: true },
			);
			return interrupted || result.code;
		}
		let config: unknown = {};
		const path = join(homedir(), ".config", "quest", "gate.json");
		try {
			config = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const result = await admit(command, gateJobs(config), backend, controller.signal);
		return interrupted || result;
	} catch (error) {
		if (interrupted) return interrupted;
		throw error;
	} finally {
		for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
	}
}
