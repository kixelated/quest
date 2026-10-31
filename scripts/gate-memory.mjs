// Linux wrapper memory for 1, 8, and 16 admitted commands blocked on stdin.
// Build first, then: scripts/gate-bench.sh memory dist/quest.js [callers...]
// On a busy host, add --waiting before the binary to measure admission waiters.
// This reports wrapper memory only, excluding commands and supervisor helpers.
// Pass a baseline bundle or compiled binary to compare the same workload.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "linux") throw new Error("gate memory measurement needs Linux /proc");
const args = process.argv.slice(2);
const waiting = args[0] === "--waiting";
if (waiting) args.shift();
const [binary, ...counts] = args;
if (!binary) throw new Error("usage: bun scripts/gate-memory.mjs [--waiting] <quest> [callers...]");
const callers = counts.length ? counts.map(Number) : [1, 8, 16];
if (callers.some((count) => !Number.isSafeInteger(count) || count < 1))
	throw new Error("callers must be positive safe integers");

const childScript = `
	process.stdout.write("ready\\n");
	process.stdin.once("data", () => process.exit(0));
	process.stdin.resume();
`;
for (const count of callers) {
	const children = [];
	try {
		const start = performance.now();
		for (let i = 0; i < count; i++) {
			const env = { ...process.env };
			if (waiting) delete env.QUEST_GATE_ADMITTED;
			else env.QUEST_GATE_ADMITTED = "1";
			const child = spawn(resolve(binary), ["gate", process.execPath, "-e", childScript], {
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});
			const exited = once(child, "exit");
			const caller = { child, exited, phase: undefined };
			children.push(caller);
			const ready = new Promise((resolve, reject) => {
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (data) => {
					stdout += data;
					if (!stdout.includes("\n")) return;
					if (stdout === "ready\n") resolve("running");
					else reject(new Error("unexpected command output"));
				});
				child.stderr.on("data", (data) => {
					stderr += data;
					if (stderr.includes("quest gate: waiting for ")) resolve("waiting");
					else process.stderr.write(data);
				});
			});
			caller.phase = await Promise.race([
				ready,
				exited.then(([code, signal]) => {
					throw new Error(`gate exited before starting the command: ${code ?? signal}`);
				}),
			]);
		}
		let pss = 0;
		let swap = 0;
		let threads = 0;
		for (const { child } of children) {
			const memory = readFileSync(`/proc/${child.pid}/smaps_rollup`, "utf8");
			const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
			pss += Number(/^Pss:\s+(\d+) kB$/m.exec(memory)[1]);
			swap += Number(/^SwapPss:\s+(\d+) kB$/m.exec(memory)[1]);
			threads += Number(/^Threads:\s+(\d+)$/m.exec(status)[1]);
		}
		console.log(
			JSON.stringify({
				callers: count,
				waiting: children.filter(({ phase }) => phase === "waiting").length,
				startup_ms: Math.round(performance.now() - start),
				pss_mib: Math.round((pss / 1024) * 10) / 10,
				swap_mib: Math.round((swap / 1024) * 10) / 10,
				threads,
			}),
		);
	} finally {
		for (const { child, phase } of children) {
			if (phase === "running") child.stdin.end("stop\n");
			else child.kill("SIGTERM");
		}
		const results = await Promise.all(children.map(({ exited }) => exited));
		if (results.some(([code], i) => code !== (children[i].phase === "running" ? 0 : 143)))
			throw new Error("a gated command failed");
	}
}
