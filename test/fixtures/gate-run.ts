import { admit, type Host, SystemdGate } from "../../src/cli/gate";
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
// These fixtures exercise slot ownership, so the host always has room.
const idle: Host = { load: () => 0, memory: () => Infinity, now: Date.now, claim: () => true, sleep: async () => {} };
try {
	const code = await admit(
		JSON.parse(process.argv[2]),
		{ jobs: 1, load: 1, memory: 0 },
		new SystemdGate(),
		idle,
		controller.signal,
	);
	process.exitCode = controller.signal.aborted ? 143 : code;
} catch (error) {
	if (controller.signal.aborted) process.exitCode = 143;
	else throw error;
}
