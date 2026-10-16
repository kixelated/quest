import { admit, type Host, SystemdGate } from "../../src/cli/gate";
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
// These fixtures exercise slot ownership, so the host load always admits.
const idle: Host = { load: () => 0, now: Date.now, claim: () => true, sleep: async () => {} };
try {
	process.exitCode = await admit(
		JSON.parse(process.argv[2]),
		{ jobs: 1, load: 1 },
		new SystemdGate(),
		idle,
		controller.signal,
	);
} catch (error) {
	if (controller.signal.aborted) process.exitCode = 143;
	else throw error;
}
