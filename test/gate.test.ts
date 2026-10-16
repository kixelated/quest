import {
	closeSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	admit,
	COMMAND_MEMORY,
	DirectGate,
	fileHost,
	type GateBackend,
	type Host,
	hostLimits,
	linuxMemory,
	openOwnership,
	SETTLE_MS,
} from "../src/cli/gate";
import { gateBoundary } from "../src/cli/main";
import { run, tempDir } from "./fixture";

const idle: Host = { load: () => 0, memory: () => Infinity, now: () => 0, claim: () => true, sleep: async () => {} };
const GiB = 2 ** 30;

test("limits derive from the host's cores and memory", () => {
	// A slot per command's memory, capped at the cores; load at one per core.
	expect(hostLimits(24, 64 * GiB)).toEqual({ jobs: 16, load: 24, memory: COMMAND_MEMORY });
	expect(hostLimits(8, 16 * GiB)).toEqual({ jobs: 4, load: 8, memory: COMMAND_MEMORY });
	expect(hostLimits(2, 64 * GiB)).toMatchObject({ jobs: 2, load: 2 });
	// A small host still runs one command, and reserves a quarter of its RAM.
	expect(hostLimits(4, 2 * GiB)).toEqual({ jobs: 1, load: 4, memory: GiB / 2 });
	expect(hostLimits().jobs).toBeGreaterThanOrEqual(1);
});

test("admission checks slots before waiting and preserves exact exit codes", async () => {
	const calls: string[] = [];
	let released = false;
	const backend: GateBackend = {
		nested: () => false,
		tryRun: async (slot, command) => {
			calls.push(`try ${slot}`);
			expect(command).toEqual(["compiler", "a $b", "--help"]);
			return released ? 23 : null;
		},
		wait: async (slot) => {
			calls.push(`wait ${slot}`);
			released = true;
		},
	};
	const limits = { jobs: 2, load: 1, memory: 1 };
	const waiting = (reason: string) => calls.push(reason);
	expect(
		await admit(["compiler", "a $b", "--help"], limits, backend, idle, new AbortController().signal, waiting),
	).toBe(23);
	expect(calls).toEqual(["try 0", "try 1", "slots", "wait 0", "try 0"]);
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
	const backend: GateBackend = {
		nested: () => false,
		tryRun: async () => (events.push("run"), 0),
		wait: () => Promise.reject(new Error("unreachable")),
	};
	const signal = new AbortController().signal;
	const limits = { jobs: 1, load: 4, memory: GiB };
	expect(await admit(["x"], limits, backend, host, signal, (reason) => events.push(reason))).toBe(0);
	expect(events).toEqual([
		"load",
		`sleep ${SETTLE_MS - 500}`,
		"memory",
		`sleep ${SETTLE_MS}`,
		"claim 4",
		`sleep ${SETTLE_MS}`,
		"claim 5",
		"run",
	]);
});

test("a window admits one claim and cleanup never admits an expired sample again", () => {
	const directory = join(tempDir(), "claims");
	let now = 5 * SETTLE_MS;
	const host = fileHost(directory, () => now);
	expect(host.claim(5)).toBe(true);
	expect(host.claim(5)).toBe(false);
	now = 6 * SETTLE_MS;
	expect(host.claim(6)).toBe(true);
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
		expect(successor.claim(6)).toBe(true);
		return 6 * SETTLE_MS;
	});
	expect(delayed.claim(5)).toBe(false);
	expect(successor.claim(6)).toBe(false);
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
	writeFileSync(join(child, limit), unified ? "max" : String(128 * GiB));
	writeFileSync(join(child, usage), String(GiB));
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 64 * GiB, available: 24 * GiB });
	// The child is unlimited, but shares an almost-full 8 GiB parent budget.
	writeFileSync(join(container, limit), String(8 * GiB));
	writeFileSync(join(container, usage), String(8 * GiB - GiB / 4));
	expect(linuxMemory(proc, cgroups)).toEqual({ total: 8 * GiB, available: GiB / 4 });
	writeFileSync(join(container, usage), String(9 * GiB));
	expect(linuxMemory(proc, cgroups).available).toBe(0);
});

test("a scope path reused before handshake acknowledgment cannot acquire cancellation ownership", () => {
	const path = join(tempDir(), "cgroup.kill");
	writeFileSync(path, "original");
	// The original shell reported this identity, then exited; the slot was reused.
	const original = statSync(path, { bigint: true }).ino;
	renameSync(path, `${path}.old`);
	writeFileSync(path, "successor");
	expect(() => openOwnership(path, original)).toThrow("exited before admission");
	expect(readFileSync(path, "utf8")).toBe("successor");
});

test("cancellation ownership stays pinned after its slot path is reused", () => {
	const path = join(tempDir(), "cgroup.kill");
	writeFileSync(path, "original");
	const handle = openOwnership(path, statSync(path, { bigint: true }).ino);
	try {
		renameSync(path, `${path}.old`);
		writeFileSync(path, "successor");
		writeSync(handle, "1");
		expect(readFileSync(`${path}.old`, "utf8")).toBe("1riginal");
		expect(readFileSync(path, "utf8")).toBe("successor");
	} finally {
		closeSync(handle);
	}
});

test("a waiting cancellation never launches the command", async () => {
	const controller = new AbortController();
	let calls = 0;
	const backend: GateBackend = {
		nested: () => false,
		tryRun: async () => {
			calls++;
			return null;
		},
		wait: async () => controller.abort(new Error("cancelled")),
	};
	await expect(
		admit(["compiler"], { jobs: 1, load: 1, memory: 1 }, backend, idle, controller.signal),
	).rejects.toThrow("cancelled");
	expect(calls).toBe(1);
});

test("load-only admission runs the command in place and marks it nested", async () => {
	const gate = new DirectGate();
	const script = "process.exit(process.env.QUEST_GATE_ADMITTED === '1' ? 7 : 1)";
	expect(await gate.tryRun(0, [process.execPath, "-e", script], new AbortController().signal)).toBe(7);
});

test("load-only admission cancels a signal aborted before listener registration", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await new DirectGate().tryRun(
		0,
		[process.execPath, "-e", "setInterval(() => {}, 1000)"],
		controller.signal,
	);
	expect(result).not.toBe(0);
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
});

test("gate has command help and requires an executable", () => {
	expect(run("gate", "--help").stdout).toContain("Arguments forwarded verbatim");
	expect(run("gate").code).toBe(2);
});
