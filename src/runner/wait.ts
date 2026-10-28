// Waiting on a pull request from inside a job. The agent has no GitHub
// access, so the runner rereads the job's context through kix, as `quest wait`
// would watch GitHub, until something the merge loop acts on changes.
/** A generation closes the race between reading context and subscribing to a later webhook hint. */
export class Changes {
	version = 0;
	#waiting = new Set<() => void>();
	wake(): void {
		this.version++;
		for (const wake of this.#waiting) wake();
	}
	wait(version: number, ms: number): Promise<void> {
		if (version !== this.version || ms <= 0) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.#waiting.delete(done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			this.#waiting.add(done);
			if (version !== this.version) done();
		});
	}
}
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
 * Reread context when an event arrives until its fingerprint differs from
 * `since` (the first read's when null), `stopped` names a reason to end, or
 * `until` passes. A wait never outlives its job's attempt.
 */
export async function waitForChange(
	read: () => Promise<unknown>,
	options: {
		since: string | null;
		until: number;
		stopped: () => string | null;
		changes?: Changes;
		now?: () => number;
		pause?: (ms: number) => Promise<unknown>;
	},
): Promise<Waited> {
	const { changes = new Changes(), now = Date.now, pause } = options;
	let since = options.since;
	for (;;) {
		const stopped = options.stopped();
		if (stopped) return { stopped };
		const version = changes.version;
		const context = await read();
		const current = fingerprint(context);
		since ??= current;
		if (current !== since) return { changed: true, context };
		const remaining = options.until - now();
		if (remaining <= 0) return { changed: false, context };
		if (pause) await pause(remaining);
		else await changes.wait(version, remaining);
	}
}
