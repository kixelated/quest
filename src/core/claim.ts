// How a quest's PR says whose move it is. A draft is its starter's claim until
// its body hands it back with a `## Decisions needed` section (the guide's
// Execution section); the CLI and the Worker read that the same way.

// Web edits end lines in CRLF.
const HAND_BACK = /^#{2}[ \t]+Decisions needed[ \t]*#*[ \t]*\r?$/im;

/** Whether a PR body hands its draft back to the maintainer; only the heading's presence matters. */
export function handedBack(body: string): boolean {
	return HAND_BACK.test(body);
}
