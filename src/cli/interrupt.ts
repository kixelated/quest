// Signal forwarding to a child that runs in Quest's own process group, shared by `quest gate`
// and `quest worktree run`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Whether /proc/<pid>/stat's process group (field 5) is its terminal's foreground group (field 8). */
export function foregroundStat(stat: string): boolean {
	// The command name in parentheses may hold spaces.
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	return fields[2] === fields[5];
}

/** Whether this process is in its controlling terminal's foreground process group. */
function foreground(): boolean {
	if (process.platform === "linux") return foregroundStat(readFileSync("/proc/self/stat", "utf8"));
	try {
		const [terminal, group] = execFileSync("ps", ["-o", "tpgid=,pgid=", "-p", String(process.pid)], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.split(/\s+/);
		return terminal === group;
	} catch {
		return false; // Forward, as for a process without a terminal.
	}
}

/**
 * Whether to pass a signal Quest received on to its child. A terminal's Ctrl-C
 * sends SIGINT to the whole foreground process group, child included, so
 * forwarding it would deliver it twice. SIGHUP and SIGTERM may be sent to Quest
 * alone, so they always pass; so does SIGINT while Quest is in the background.
 * A SIGINT sent with `kill` to a foreground Quest alone is therefore not
 * forwarded. Windows delivers Ctrl-C to every process on the console and has
 * no signal to forward: `child.kill()` terminates the child outright.
 */
export function forwards(name: NodeJS.Signals): boolean {
	if (process.platform === "win32") return false;
	return name !== "SIGINT" || !foreground();
}
