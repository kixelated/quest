// The bundled executable: run the CLI against the process.

import { main } from "./main";
import { detect } from "./theme";

// A reader that stops early, as in `quest ready | head -1`, closes the pipe.
// The output is unwanted, so stop writing and keep the command's exit status;
// any other write error still crashes.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code !== "EPIPE") throw error;
});

process.exitCode = main(process.argv.slice(2), {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	terminal: detect(process.stdout.isTTY, process.env),
});
