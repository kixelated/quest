// The bundled executable: run the CLI against the process.

import { main } from "./main";
import { detect } from "./theme";

process.exitCode = main(process.argv.slice(2), {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	terminal: detect(process.stdout.isTTY, process.env),
});
