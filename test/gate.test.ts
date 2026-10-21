import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
	admit,
	COMMAND_MEMORY,
	claimDirectory,
	fileHost,
	gate,
	type Host,
	hostLimits,
	linuxMemory,
	run as runCommand,
	SETTLE_MS,
} from "../src/cli/gate";
import { gateBoundary, main } from "../src/cli/main";
import { run, tempDir } from "./fixture";

const GiB = 2 ** 30;

afterEach(() => vi.unstubAllEnvs());

test("limits derive from the host's CPUs and memory", () => {
	// The host-wide load average is compared with every host CPU, not the
	// process's affinity subset, so an idle assigned CPU is not held back.
	expect(hostLimits(24, 64 * GiB)).toEqual({ load: 24, memory: COMMAND_MEMORY });
	// A small host still runs one command, and reserves a quarter of its RAM.
	expect(hostLimits(4, 2 * GiB)).toEqual({ load: 4, memory: GiB / 2 });
	expect(hostLimits().load).toBeGreaterThanOrEqual(1);
});

test("load and memory pressure wait, then admit one caller per settle window", async () => {
	const events: string[] = [];
	const taken = new Set([4]); // Another waiter won the first window once the host had room.
	let now = 2 * SETTLE_MS + 500;
	let load = 9;
	let memory = 0;
	const host: Host = {
		load: () => load,
		memory: () => memory,
		now: () => now,
		claim: (window) => {
			events.push(`claim ${window}`);
			if (taken.has(window)) return false;
			taken.add(window);
			return true;
		},
		sleep: async (ms) => {
			events.push(`sleep ${ms}`);
			now += ms;
			if (load > 4) load = 3;
			else memory = GiB;
		},
	};
	const signal = new AbortController().signal;
	await admit({ load: 4, memory: GiB }, host, signal, (reason) => events.push(reason));
	expect(events).toEqual([
		"load",
		`sleep ${SETTLE_MS - 500}`,
		"memory",
		`sleep ${SETTLE_MS}`,
		"claim 4",
		`sleep ${SETTLE_MS}`,
		"claim 5",
	]);
});

test("a window admits one claim and cleanup never admits an expired sample again", () => {
	const directory = join(tempDir(), "claims");
	let now = 5 * SETTLE_MS;
	const host = fileHost(directory, () => now);
	expect(host.claim(5)).toBe(true);
	expect(host.claim(5)).toBe(false);
	now = 7 * SETTLE_MS;
	expect(host.claim(7)).toBe(true);
	expect(existsSync(join(directory, "5"))).toBe(false);
	// A waiter sampled 5 before descheduling, then resumes after cleanup.
	expect(host.claim(5)).toBe(false);
	expect(existsSync(join(directory, "5"))).toBe(false);
	expect(host.load()).toBeGreaterThanOrEqual(0);
	expect(host.memory()).toBeGreaterThan(0);
});

test("a claim that crosses rollover during filesystem work does not admit", () => {
	const directory = join(tempDir(), "claims");
	const successor = fileHost(directory, () => 6 * SETTLE_MS);
	let calls = 0;
	const delayed = fileHost(directory, () => {
		if (++calls === 1) return 5 * SETTLE_MS;
		// The pending claim may still admit, so the next window must wait for it.
		expect(successor.claim(6)).toBe(false);
		return 6 * SETTLE_MS;
	});
	expect(delayed.claim(5)).toBe(false);
	// The expired claim admitted nothing and is gone, so the next window is free.
	expect(existsSync(join(directory, "5"))).toBe(false);
	expect(successor.claim(6)).toBe(true);
});

test("admissions stay a full window apart across a window boundary", () => {
	const directory = join(tempDir(), "claims");
	let now = 5 * SETTLE_MS - 1;
	const host = fileHost(directory, () => now);
	expect(host.claim(4)).toBe(true);
	// A waiter at the next boundary, 1 ms later, must not start alongside it.
	now = 5 * SETTLE_MS;
	expect(host.claim(5)).toBe(false);
	// The refused claim is removed: it admitted nothing, so it holds back no one.
	expect(existsSync(join(directory, "5"))).toBe(false);
	expect(host.claim(5)).toBe(false);
	now = 6 * SETTLE_MS;
	expect(host.claim(6)).toBe(true);
	expect(existsSync(join(directory, "4"))).toBe(false);
});

test.each(["v1", "v2"])("Linux memory counts reclaimable cache and bounds %s container headroom", (version) => {
	const proc = tempDir();
	const cgroups = tempDir();
	mkdirSync(join(proc, "self"));
	writeFileSync(
		join(proc, "meminfo"),
		`MemTotal: ${(64 * GiB) / 1024} kB\nMemFree: 1024 kB\nMemAvailable: ${(24 * GiB) / 1024} kB\n`,
	);
	const unified = version === "v2";
	writeFileSync(join(proc, "self/cgroup"), unified ? "0::/container/child\n" : "3:memory:/container/child\n");
	const root = unified ? cgroups : join(cgroups, "memory");
	const container = join(root, "container");
	const child = join(container, "child");
	mkdirSync(child, { recursive: true });
	const limit = unified ? "memory.max" : "memory.limit_in_bytes";
	const usage = unified ? "memory.current" : "memory.usage_in_bytes";
	const cache = unified ? "inactive_file" : "total_inactive_file";
	writeFileSync(join(child, limit), unified ? "max" : String(128 * GiB));
	writeFileSync(join(child, usage), String(GiB));
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 64 * GiB, available: 24 * GiB });
	// The child is unlimited, but shares an almost-full 8 GiB parent budget.
	writeFileSync(join(container, limit), String(8 * GiB));
	writeFileSync(join(container, usage), String(8 * GiB - GiB / 4));
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 8 * GiB, available: GiB / 4 });
	// Inactive file cache inside the budget is reclaimable, so it counts as available.
	writeFileSync(join(container, "memory.stat"), `active_file 1\n${cache} ${6 * GiB}\nanon 2\n`);
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 8 * GiB, available: 6 * GiB + GiB / 4 });
	writeFileSync(join(container, "memory.stat"), `${cache} 0\n`);
	writeFileSync(join(container, usage), String(9 * GiB));
	expect(linuxMemory(proc, cgroups).available).toBe(0);
});

test("Linux memory reads the container cgroup mounted as the root", () => {
	const proc = tempDir();
	const cgroups = tempDir();
	mkdirSync(join(proc, "self"));
	writeFileSync(join(proc, "meminfo"), `MemTotal: ${(64 * GiB) / 1024} kB\nMemAvailable: ${(24 * GiB) / 1024} kB\n`);
	writeFileSync(join(cgroups, "memory.max"), String(8 * GiB));
	writeFileSync(join(cgroups, "memory.current"), String(2 * GiB));
	const limited = { total: 8 * GiB, available: 6 * GiB };
	// With a cgroup namespace, the container's own cgroup is `/`.
	writeFileSync(join(proc, "self/cgroup"), "0::/\n");
	expect(linuxMemory(proc, cgroups)).toEqual(limited);
	// Without one, the host path is absent below the bind-mounted container cgroup.
	writeFileSync(join(proc, "self/cgroup"), "0::/system.slice/docker-abc.scope\n");
	expect(linuxMemory(proc, cgroups)).toEqual(limited);
	// A cgroup outside the namespace is not mounted, so nothing visible bounds it.
	writeFileSync(join(proc, "self/cgroup"), "0::/../sibling\n");
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 64 * GiB, available: 24 * GiB });
});

test("admission claims stay on this host", () => {
	expect(claimDirectory({ XDG_RUNTIME_DIR: "/run/user/1000" }, "/home/u", "a")).toBe(
		join("/run/user/1000", "quest", "gate"),
	);
	// A home directory shared between machines keeps each host's claims apart.
	expect(claimDirectory({}, "/home/u", "a")).toBe(join("/home/u", ".cache", "quest", "gate", "a"));
	expect(claimDirectory({}, "/home/u", "b")).not.toBe(claimDirectory({}, "/home/u", "a"));
});

test("cancelling a waiting caller rejects admission", async () => {
	const controller = new AbortController();
	const busy: Host = {
		load: () => 9,
		memory: () => Infinity,
		now: () => 0,
		claim: () => true,
		sleep: async () => controller.abort(new Error("cancelled")),
	};
	await expect(admit({ load: 1, memory: 1 }, busy, controller.signal)).rejects.toThrow("cancelled");
});

test("an admitted command runs in place and is marked nested", async () => {
	const script = "process.exit(process.env.QUEST_GATE_ADMITTED === '1' ? 7 : 1)";
	expect(await runCommand([process.execPath, "-e", script], new AbortController().signal)).toBe(7);
});

test("a nested gate runs at once and keeps the exact exit status", async () => {
	// A gated recipe that calls another one must not wait for admission twice.
	vi.stubEnv("QUEST_GATE_ADMITTED", "1");
	expect(await gate([process.execPath, "-e", "process.exit(23)"])).toBe(23);
});

test("a command cancelled before listener registration still stops", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await runCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], controller.signal);
	expect(result).not.toBe(0);
});

// Windows has no POSIX signals to forward; kill() always terminates there.
test.skipIf(process.platform === "win32")("cancellation forwards the received signal to the command", async () => {
	const controller = new AbortController();
	controller.abort("SIGINT");
	const result = await runCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], controller.signal);
	expect(result).toBe(128 + constants.signals.SIGINT);
});

test("the gated command keeps its own flags, even ones Quest also parses", () => {
	expect(gateBoundary(["gate", "bun", "--help", "--root", "x"])).toEqual([
		"gate",
		"--",
		"bun",
		"--help",
		"--root",
		"x",
	]);
	expect(gateBoundary(["--root", "r", "gate", "ls"])).toEqual(["--root", "r", "gate", "--", "ls"]);
	expect(gateBoundary(["gate", "--help"])).toEqual(["gate", "--help"]);
	expect(gateBoundary(["check"])).toEqual(["check"]);
	// Quest's own global options may also follow the subcommand.
	expect(gateBoundary(["gate", "--root", "r", "ls"])).toEqual(["gate", "--root", "r", "--", "ls"]);
	expect(gateBoundary(["gate", "--root=r", "ls"])).toEqual(["gate", "--root=r", "--", "ls"]);
	expect(gateBoundary(["gate", "--version"])).toEqual(["gate", "--version"]);
});

test("global options after gate keep working", async () => {
	expect(run("gate", "--version").stdout).toMatch(/^quest /);
	vi.stubEnv("QUEST_GATE_ADMITTED", "1");
	const out = { stdout: () => {}, stderr: () => {} };
	expect(await main(["gate", "--root", ".", process.execPath, "-e", "process.exit(5)"], out)).toBe(5);
});

test("gate has command help and requires an executable", () => {
	expect(run("gate", "--help").stdout).toContain("Arguments forwarded verbatim");
	expect(run("gate").code).toBe(2);
});
