// Runner messages over the live connection. Every field is untrusted input.
import { type AccountReport, type Attempt, JobError, type Outcome } from "./store";

export function text(value: unknown, max: number): string | null {
	return typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;
}
export function id(value: unknown): string | null {
	return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
}
// Prompts, results, and summaries are untrusted agent data stored as given.
export function data(value: unknown, max: number) {
	if (value !== undefined && JSON.stringify(value).length > max) throw new JobError("Payload too large");
	return value;
}
function attempt(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new JobError("Attempt required");
	return value;
}
function seq(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new JobError("Sequence required");
	return value;
}
function count(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100)
		throw new JobError("Slots required");
	return value;
}

export type RunnerMessage = { id?: string | number } & (
	| { type: "status"; accounts: AccountReport[]; attempts: Attempt[]; slots: number }
	| ({ type: "checkpoint"; summary: string; session: string | null } & Attempt)
	| ({ type: "question"; summary: string; session: string; prompt: unknown } & Attempt)
	| ({ type: "output"; seq: number; text: string } & Attempt)
	| ({ type: "result"; outcome: Outcome; summary: string; result: unknown } & Attempt)
);

function account(value: unknown): AccountReport {
	const item = value as Record<string, unknown> | null;
	const report = {
		id: id(item?.id),
		provider: id(item?.provider),
		kind: item?.kind,
		label: text(item?.label, 100),
		limited: item?.limited,
	};
	if (
		!report.id ||
		!report.provider ||
		!report.label ||
		(report.kind !== "subscription" && report.kind !== "api-key") ||
		typeof report.limited !== "boolean"
	)
		throw new JobError("Invalid account");
	return report as AccountReport;
}

function target(body: Record<string, unknown>): Attempt {
	const job = id(body.job);
	if (!job) throw new JobError("Job required");
	return { job, attempt: attempt(body.attempt) };
}

/** Parse one runner message, or throw a JobError the runner can read. */
export function parse(raw: string | ArrayBuffer): RunnerMessage {
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
	} catch {
		throw new JobError("JSON object required");
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new JobError("JSON object required");
	const ref =
		body.id === undefined
			? {}
			: typeof body.id === "number" || id(body.id)
				? { id: body.id as string | number }
				: null;
	if (!ref) throw new JobError("Invalid message id");
	try {
		return fields(body, ref);
	} catch (error) {
		if (error instanceof JobError) throw new MessageError(error.message, ref.id);
		throw error;
	}
}

/** A rejected message, carrying its id so the runner can match the reply. */
export class MessageError extends JobError {
	constructor(
		message: string,
		readonly id?: string | number,
	) {
		super(message);
	}
}

function fields(body: Record<string, unknown>, ref: { id?: string | number }): RunnerMessage {
	const summary = text(body.summary, 4000);
	switch (body.type) {
		case "status": {
			if (!Array.isArray(body.accounts) || !Array.isArray(body.attempts) || body.attempts.length > 100)
				throw new JobError("Accounts and attempts required");
			const accounts = body.accounts.map(account);
			if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new JobError("Duplicate account");
			return { ...ref, type: "status", accounts, attempts: body.attempts.map(target), slots: count(body.slots) };
		}
		case "checkpoint": {
			const session = body.session === undefined ? null : text(body.session, 200);
			if (!summary || (body.session !== undefined && !session)) throw new JobError("Summary required");
			return { ...ref, type: "checkpoint", ...target(body), summary, session };
		}
		case "question": {
			const session = text(body.session, 200);
			if (!summary || !session || body.prompt === undefined)
				throw new JobError("Summary, session, and prompt required");
			return {
				...ref,
				type: "question",
				...target(body),
				summary,
				session,
				prompt: data(body.prompt, 64 * 1024),
			};
		}
		case "output":
			// Each chunk is one D1 row, which caps values at 2 MB of UTF-8.
			if (typeof body.text !== "string" || !body.text || new TextEncoder().encode(body.text).length > 1024 * 1024)
				throw new JobError("Output text required, at most 1 MiB per message");
			return { ...ref, type: "output", ...target(body), seq: seq(body.seq), text: body.text };
		case "result": {
			const outcome = body.outcome;
			if (
				!summary ||
				(outcome !== "completed" && outcome !== "failed" && outcome !== "cancelled" && outcome !== "limited")
			)
				throw new JobError("Outcome and summary required");
			return { ...ref, type: "result", ...target(body), outcome, summary, result: data(body.result, 64 * 1024) };
		}
		default:
			throw new JobError("Unknown message type");
	}
}
