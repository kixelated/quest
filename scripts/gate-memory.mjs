// Linux wrapper memory while 1, 8, and 16 gated commands block on stdin.
// Build first, then: bun scripts/gate-memory.mjs dist/quest.js [callers...]
// Pass a baseline bundle or compiled binary to compare the same workload.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "linux") throw new Error("gate memory measurement needs Linux /proc");
const [binary, ...counts] = process.argv.slice(2);
if (!binary) throw new Error("usage: bun scripts/gate-memory.mjs <quest> [callers...]");
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
			const child = spawn(resolve(binary), ["gate", process.execPath, "-e", childScript], {
				env: { ...process.env, QUEST_GATE_ADMITTED: "1" },
				stdio: ["pipe", "pipe", "inherit"],
			});
			const exited = once(child, "exit");
			children.push({ child, exited });
			const ready = once(child.stdout, "data");
			const data = await Promise.race([
				ready,
				exited.then(([code, signal]) => {
					throw new Error(`gate exited before starting the command: ${code ?? signal}`);
				}),
			]);
			if (data[0].toString() !== "ready\n") throw new Error("unexpected command output");
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
				startup_ms: Math.round(performance.now() - start),
				pss_mib: Math.round((pss / 1024) * 10) / 10,
				swap_mib: Math.round((swap / 1024) * 10) / 10,
				threads,
			}),
		);
	} finally {
		for (const { child } of children) child.stdin.end("stop\n");
		const results = await Promise.all(children.map(({ exited }) => exited));
		if (results.some(([code]) => code !== 0)) throw new Error("a gated command failed");
	}
}
