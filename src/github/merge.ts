// GitHub-specific landing decisions shared by the CLI and the Worker.
// Keep these outside the tracker-independent quest core.

/** GitHub merges these states at once and refuses auto-merge because the PR is clean. */
export function immediateMerge(state: string, queue: boolean): boolean {
	return !queue && ["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(state);
}

/** The one refusal that warrants rereading an initially unknown merge state. */
export function cleanAutoMergeRefusal(message: unknown): boolean {
	return typeof message === "string" && /\bpull request is in clean status\b/i.test(message);
}
