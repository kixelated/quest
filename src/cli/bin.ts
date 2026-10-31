// The bundled executable: run the CLI against the process.

import { main } from "./entry";
import { detect } from "./theme";

// A reader that stops early, as in `quest unblocked | head -1`, closes the pipe.
// The output is unwanted, so stop writing and keep the command's exit status;
// any other write error still crashes.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code !== "EPIPE") throw error;
});

process.exitCode = await main(process.argv.slice(2), {
	stdout: (text) => void process.stdout.write(text),
	stderr: (text) => void process.stderr.write(text),
	terminal: detect(process.stdout.isTTY, process.env),
});
