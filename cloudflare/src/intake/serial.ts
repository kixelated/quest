// A DO may interleave RPCs across await. Chain the entire read/check/write
// operation, not just the storage calls. Persisted Git operation IDs handle
// eviction or a lost response; this queue handles concurrent live invocations.
export class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();
	run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => undefined);
		return result;
	}
}
