import { expect, test } from "vitest";
import { admit, gateJobs, type GateBackend } from "../src/cli/gate";
import { run } from "./fixture";

test("gate configuration defaults to CPUs and rejects unsafe limits", () => {
	expect(gateJobs({}, 6)).toBe(6);
	expect(gateJobs({ jobs: 2 }, 6)).toBe(2);
	for (const config of [null, [], { jobs: null }, { jobs: 0 }, { jobs: 1.5 }, { jobs: "2" }, { jobs: Infinity }]) {
		expect(() => gateJobs(config)).toThrow();
	}
});

test("admission checks slots before waiting and preserves exact exit codes", async () => {
	const calls: string[] = [];
	let released = false;
	const backend: GateBackend = {
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
	expect(await admit(["compiler", "a $b", "--help"], 2, backend, new AbortController().signal)).toBe(23);
	expect(calls).toEqual(["try 0", "try 1", "wait 0", "try 0"]);
});

test("a waiting cancellation never launches the command", async () => {
	const controller = new AbortController();
	let calls = 0;
	const backend: GateBackend = {
		tryRun: async () => {
			calls++;
			return null;
		},
		wait: async () => controller.abort(new Error("cancelled")),
	};
	await expect(admit(["compiler"], 1, backend, controller.signal)).rejects.toThrow("cancelled");
	expect(calls).toBe(1);
});

test("gate has command help and requires an executable", () => {
	expect(run("gate", "--help").stdout).toContain("Arguments forwarded verbatim");
	expect(run("gate").code).toBe(2);
});
