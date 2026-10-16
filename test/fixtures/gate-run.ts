import { admit, SystemdGate } from "../../src/cli/gate";
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
try {
	process.exitCode = await admit(JSON.parse(process.argv[2]), 1, new SystemdGate(), controller.signal);
} catch (error) {
	if (controller.signal.aborted) process.exitCode = 143;
	else throw error;
}
