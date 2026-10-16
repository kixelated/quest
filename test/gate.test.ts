import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { admit, DirectGate, fileHost, gateLimits, type GateBackend, type Host, SETTLE_MS } from "../src/cli/gate";
import { run, tempDir } from "./fixture";

const idle: Host = { load: () => 0, now: () => 0, claim: () => true, sleep: async () => {} };

test("gate configuration defaults to CPUs and rejects unsafe limits", () => {
	expect(gateLimits({}, 6)).toEqual({ jobs: 6, load: 6 });
	expect(gateLimits({ jobs: 2, load: 1.5 }, 6)).toEqual({ jobs: 2, load: 1.5 });
	for (const config of [
		null,
		[],
		{ jobs: null },
		{ jobs: 0 },
		{ jobs: 1.5 },
		{ jobs: "2" },
		{ jobs: Infinity },
		{ load: 0 },
		{ load: "2" },
		{ load: Infinity },
	]) {
		expect(() => gateLimits(config)).toThrow();
	}
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
	const limits = { jobs: 2, load: 1 };
	const waiting = (reason: string) => calls.push(reason);
	expect(
		await admit(["compiler", "a $b", "--help"], limits, backend, idle, new AbortController().signal, waiting),
	).toBe(23);
	expect(calls).toEqual(["try 0", "try 1", "slots", "wait 0", "try 0"]);
});

test("a high load waits, then admits one caller per settle window", async () => {
	const events: string[] = [];
	const taken = new Set([3]); // Another waiter won the first window after the load fell.
	let now = 2 * SETTLE_MS + 500;
	let load = 9;
	const host: Host = {
		load: () => load,
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
			load = 3;
		},
	};
	const backend: GateBackend = {
		nested: () => false,
		tryRun: async () => (events.push("run"), 0),
		wait: () => Promise.reject(new Error("unreachable")),
	};
	const signal = new AbortController().signal;
	expect(await admit(["x"], { jobs: 1, load: 4 }, backend, host, signal, (reason) => events.push(reason))).toBe(0);
	expect(events).toEqual(["load", `sleep ${SETTLE_MS - 500}`, "claim 3", `sleep ${SETTLE_MS}`, "claim 4", "run"]);
});

test("a window admits one claim and later claims clear older windows", () => {
	const directory = join(tempDir(), "claims");
	const host = fileHost(directory);
	expect(host.claim(5)).toBe(true);
	expect(host.claim(5)).toBe(false);
	expect(host.claim(6)).toBe(true);
	expect(existsSync(join(directory, "5"))).toBe(false);
	expect(host.load()).toBeGreaterThanOrEqual(0);
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
	await expect(admit(["compiler"], { jobs: 1, load: 1 }, backend, idle, controller.signal)).rejects.toThrow(
		"cancelled",
	);
	expect(calls).toBe(1);
});

test("load-only admission runs the command in place and marks it nested", async () => {
	const gate = new DirectGate();
	const script = "process.exit(process.env.QUEST_GATE_ADMITTED === '1' ? 7 : 1)";
	expect(await gate.tryRun(0, [process.execPath, "-e", script], new AbortController().signal)).toBe(7);
});

test("gate has command help and requires an executable", () => {
	expect(run("gate", "--help").stdout).toContain("Arguments forwarded verbatim");
	expect(run("gate").code).toBe(2);
});
