// The bundled executable: run the CLI against the process.

import { main } from "./main";

process.exitCode = main(process.argv.slice(2), {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
});
