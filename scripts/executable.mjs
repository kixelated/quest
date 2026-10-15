// Windows executes the Bun shim or .exe; POSIX installs execute this shebang file.
import { chmodSync } from "node:fs";
if (process.platform !== "win32") chmodSync(process.argv[2], 0o755);
