// The runner's one live connection to its owner's hub. Requests are matched
// to replies by id and survive reconnects: each is sent again on the next
// connection, which the hub accepts as an identical retry. Statuses are never
// resent, since a fresh one replaces them.
import type { Message, Push } from "./protocol";
import { parsePush } from "./protocol";

/** The parts of a WebSocket the connection uses, so tests can supply their own. */
export interface Socket {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type Dial = (url: string, token: string) => Socket;

/** Bun's and Node's WebSocket both take request headers as a second argument's `headers`. */
export const dialWebSocket: Dial = (url, token) => {
	const Constructor = WebSocket as unknown as new (
		url: string,
		options: { headers: Record<string, string> },
	) => Socket;
	return new Constructor(url, { headers: { Authorization: `Bearer ${token}` } });
};

/** The hub refused a message; retrying it cannot help. */
export class Refused extends Error {}

/** The hub closed this connection for a newer one with the same token. */
export const REPLACED = 4000;

interface Pending {
	text: string;
	status: boolean;
	resolve(reply: Record<string, unknown>): void;
	reject(error: Error): void;
}

export interface ConnectionEvents {
	/** A connection opened; send a fresh status before anything else. */
	open(): void;
	push(push: Push): void;
	/** The hub replaced this runner's connection with another process's; the runner should exit. */
	replaced(): void;
	log(line: string): void;
}

/** Reconnect delays: doubling from one second to a minute, with jitter. */
export function backoff(failures: number, random = Math.random): number {
	const base = Math.min(60_000, 1000 * 2 ** Math.min(failures, 6));
	return Math.round(base * (0.8 + 0.4 * random()));
}

export class Connection {
	#pending = new Map<number, Pending>();
	#next = 1;
	#socket: Socket | undefined;
	#open = false;
	#closed = false;
	#failures = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		readonly url: string,
		readonly token: string,
		readonly events: ConnectionEvents,
		readonly dial: Dial = dialWebSocket,
	) {}

	start(): void {
		this.#connect();
	}

	/** Close for good; pending requests are rejected. */
	close(): void {
		this.#closed = true;
		clearTimeout(this.#timer);
		this.#socket?.close(1000, "Runner stopped");
		for (const pending of this.#pending.values()) pending.reject(new Error("Runner stopped"));
		this.#pending.clear();
	}

	get open(): boolean {
		return this.#open;
	}

	/**
	 * Send a message and wait for its reply. A refusal rejects with `Refused`;
	 * a lost connection only delays the reply until the message is resent.
	 */
	request(message: Message): Promise<Record<string, unknown>> {
		const id = this.#next++;
		const text = JSON.stringify({ ...message, id });
		return new Promise((resolve, reject) => {
			if (this.#closed) return reject(new Error("Runner stopped"));
			this.#pending.set(id, { text, status: message.type === "status", resolve, reject });
			if (this.#open) this.#socket!.send(text);
		});
	}

	#connect(): void {
		if (this.#closed) return;
		let socket: Socket;
		try {
			socket = this.dial(this.url, this.token);
		} catch (error) {
			this.events.log(`could not connect: ${error instanceof Error ? error.message : String(error)}`);
			return this.#retry();
		}
		this.#socket = socket;
		socket.onopen = () => {
			this.#open = true;
			this.events.log("connected");
			// Statuses from the last connection are stale; the open handler sends a fresh one.
			for (const [id, pending] of this.#pending)
				if (pending.status) {
					this.#pending.delete(id);
					pending.resolve({ superseded: true });
				}
			const resend = [...this.#pending.values()];
			this.events.open();
			for (const pending of resend) socket.send(pending.text);
		};
		socket.onmessage = (event) => this.#receive(event.data);
		socket.onerror = () => {};
		socket.onclose = (event) => {
			const was = this.#open;
			this.#open = false;
			if (this.#socket !== socket) return;
			this.#socket = undefined;
			if (this.#closed) return;
			if (event.code === REPLACED) {
				this.events.log("another runner process took over this runner's connection");
				return this.events.replaced();
			}
			this.events.log(`disconnected${event.reason ? `: ${event.reason}` : ""}`);
			if (was) this.#failures = 0;
			this.#retry();
		};
	}

	#retry(): void {
		const delay = backoff(this.#failures++);
		this.#timer = setTimeout(() => this.#connect(), delay);
	}

	#receive(data: unknown): void {
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer));
		} catch {
			return this.events.log("ignored a message that is not JSON");
		}
		if (body?.type === "reply") {
			const pending = this.#pending.get(body.id as number);
			if (!pending) return;
			this.#pending.delete(body.id as number);
			if (typeof body.error === "string") pending.reject(new Refused(body.error));
			else pending.resolve(body);
			return;
		}
		const push = parsePush(body);
		if (push) this.events.push(push);
		else this.events.log(`ignored an unexpected ${String(body?.type)} message`);
	}
}
