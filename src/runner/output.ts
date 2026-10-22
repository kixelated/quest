// An attempt's raw agent output, uploaded as numbered `output` chunks behind
// the maintainer-only disclosure. Chunks go one at a time, in order, with a
// contiguous `seq` from 0. Output is batched so a long attempt stays well
// under the hub's 4096 chunks; a `truncated` reply means the attempt reached
// its 64 MiB cap, so uploading stops while the job carries on.

/** The hub's limit on one chunk's UTF-8 text. */
export const CHUNK_LIMIT = 1024 * 1024;
/** Upload once this much is buffered... */
export const FLUSH_BYTES = 256 * 1024;
/** ...or this long after the oldest buffered output arrived. */
export const FLUSH_MS = 60_000;

/** Sends one chunk and resolves with the hub's reply; rejects when the hub refused it. */
export type SendChunk = (seq: number, text: string) => Promise<{ truncated?: unknown }>;

/**
 * Split `text` into pieces of at most `limit` UTF-8 bytes, never inside a
 * character, so each piece is valid text on its own.
 */
export function split(text: string, limit = CHUNK_LIMIT): string[] {
	const bytes = Buffer.from(text, "utf8");
	const pieces: string[] = [];
	let start = 0;
	while (start < bytes.length) {
		let end = Math.min(bytes.length, start + limit);
		// Back off continuation bytes (10xxxxxx) so the cut falls between characters.
		while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
		pieces.push(bytes.subarray(start, end).toString("utf8"));
		start = end;
	}
	return pieces;
}

export class OutputUploader {
	#buffer = "";
	#bytes = 0;
	#seq = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#chain: Promise<void> = Promise.resolve();
	#stopped = false;

	constructor(
		readonly send: SendChunk,
		readonly log: (line: string) => void = () => {},
		readonly flushBytes = FLUSH_BYTES,
		readonly flushMs = FLUSH_MS,
	) {}

	/** Buffer output; it uploads once enough has gathered or it has waited long enough. */
	write(text: string): void {
		if (this.#stopped || text === "") return;
		this.#buffer += text;
		this.#bytes += Buffer.byteLength(text);
		if (this.#bytes >= this.flushBytes) this.flush();
		else this.#timer ??= setTimeout(() => this.flush(), this.flushMs);
	}

	/** Upload what is buffered now. */
	flush(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const text = this.#buffer;
		this.#buffer = "";
		this.#bytes = 0;
		if (text === "" || this.#stopped) return;
		for (const piece of split(text)) {
			this.#chain = this.#chain.then(async () => {
				if (this.#stopped) return;
				const seq = this.#seq;
				try {
					const reply = await this.send(seq, piece);
					this.#seq++;
					if (reply.truncated) {
						this.log("raw output reached the attempt's cap; the rest is not uploaded");
						this.#stopped = true;
					}
				} catch (error) {
					// The connection resends a chunk itself, so only a refusal lands here.
					this.log(`raw output upload stopped: ${error instanceof Error ? error.message : String(error)}`);
					this.#stopped = true;
				}
			});
		}
	}

	/** Upload the rest and wait until every chunk has its reply. */
	async close(): Promise<void> {
		this.flush();
		await this.#chain;
	}
}
