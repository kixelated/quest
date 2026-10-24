// Waiting on a pull request from inside a job. The agent has no GitHub
// access, so the runner rereads the job's context through kix, as `quest wait`
// would watch GitHub, until something the merge loop acts on changes.
import { setTimeout as sleep } from "node:timers/promises";

/** How often a wait rereads the pull request. */
export const WAIT_INTERVAL = 60_000;
/** The longest one wait lasts, under an hour like `quest wait --timeout 3300`. */
export const WAIT_LIMIT = 55 * 60_000;

/**
 * What the merge loop acts on in a pull request's context, as `context`
 * returns it: its state, head, overall checks, and its reviews, comments,
 * and unresolved review threads. These are whole entries rather than counts,
 * since kix reads only the latest ones and a new entry can replace an old
 * one. A single check finishing among many does not count until the overall
 * state changes.
 */
export function fingerprint(context: unknown): string {
	const pull = (context ?? {}) as {
		state?: unknown;
		draft?: unknown;
		head?: { oid?: unknown };
		checks?: { commit?: unknown; state?: unknown };
		reviews?: unknown;
		comments?: unknown;
		threads?: unknown;
	};
	return JSON.stringify([
		pull.state,
		pull.draft,
		pull.head?.oid,
		pull.checks?.commit,
		pull.checks?.state,
		pull.reviews,
		pull.comments,
		pull.threads,
	]);
}

export type Waited = { changed: boolean; context: unknown } | { stopped: string };

/**
 * Reread the context every `interval` until its fingerprint differs from
 * `since` (the first read's when null), `stopped` names a reason to end, or
 * `until` passes. A wait never outlives its job's attempt.
 */
export async function waitForChange(
	read: () => Promise<unknown>,
	options: {
		since: string | null;
		until: number;
		stopped: () => string | null;
		interval?: number;
		now?: () => number;
		pause?: (ms: number) => Promise<unknown>;
	},
): Promise<Waited> {
	const { interval = WAIT_INTERVAL, now = Date.now, pause = sleep } = options;
	let since = options.since;
	for (;;) {
		const stopped = options.stopped();
		if (stopped) return { stopped };
		const context = await read();
		const current = fingerprint(context);
		since ??= current;
		if (current !== since) return { changed: true, context };
		if (now() + interval > options.until) return { changed: false, context };
		await pause(interval);
	}
}
