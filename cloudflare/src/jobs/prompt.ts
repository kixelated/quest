// The prompt contract between agents and the decision inbox. An agent asks one
// round of independent questions; dependent questions wait for a later round.
// The UI renders the round and returns only what the maintainer chose or wrote.
// Prompts and answers are untrusted data, so both are validated here.
import { JobError } from "./store";

export type Option = { label: string; description?: string; recommended?: boolean };
export type Ask = { header?: string; question: string; options: Option[]; multiple?: boolean };
/**
 * A product decision for the maintainer, or a tool permission request from the
 * agent's harness. Ordinary progress is a checkpoint summary, never a prompt.
 */
export type Prompt = { kind: "decision" | "permission"; questions: Ask[] };
/** One reply per question, in order: chosen option labels, free text, or both. */
export type Answer = { answers: { choices: string[]; text?: string }[] };

const limits = { questions: 10, options: 10, header: 60, question: 2000, label: 200, description: 2000, text: 4000 };

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function string(value: unknown, max: number, optional = false): string | undefined {
	if (value === undefined && optional) return undefined;
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new JobError("Invalid prompt");
	return value;
}

/** Validate a runner's prompt. */
export function parsePrompt(value: unknown): Prompt {
	const body = record(value);
	const kind = body?.kind ?? "decision";
	if (!body || (kind !== "decision" && kind !== "permission")) throw new JobError("Invalid prompt");
	if (!Array.isArray(body.questions) || !body.questions.length || body.questions.length > limits.questions)
		throw new JobError("A prompt asks 1 to 10 questions");
	const questions = body.questions.map((raw): Ask => {
		const ask = record(raw);
		if (!ask || !Array.isArray(ask.options) || ask.options.length > limits.options)
			throw new JobError("Each question offers at most 10 options");
		if (ask.multiple !== undefined && typeof ask.multiple !== "boolean") throw new JobError("Invalid prompt");
		const options = ask.options.map((raw): Option => {
			const option = record(raw);
			if (!option || (option.recommended !== undefined && typeof option.recommended !== "boolean"))
				throw new JobError("Invalid prompt");
			return {
				label: string(option.label, limits.label)!,
				...(option.description !== undefined && {
					description: string(option.description, limits.description),
				}),
				...(option.recommended && { recommended: true }),
			};
		});
		if (new Set(options.map((o) => o.label)).size !== options.length)
			throw new JobError("Option labels must be unique");
		return {
			...(ask.header !== undefined && { header: string(ask.header, limits.header) }),
			question: string(ask.question, limits.question)!,
			options,
			...(ask.multiple && { multiple: true }),
		};
	});
	return { kind, questions };
}

/** Validate a maintainer's answer against the question it answers. */
export function parseAnswer(prompt: Prompt, value: unknown): Answer {
	const answers = record(value)?.answers;
	if (!Array.isArray(answers) || answers.length !== prompt.questions.length)
		throw new JobError("Answer every question");
	return {
		answers: prompt.questions.map((ask, i) => {
			const reply = record(answers[i]);
			const choices = reply?.choices ?? [];
			const text = typeof reply?.text === "string" ? reply.text.trim() : reply?.text;
			if (
				!Array.isArray(choices) ||
				choices.some((c) => !ask.options.some((o) => o.label === c)) ||
				new Set(choices).size !== choices.length ||
				(!ask.multiple && choices.length > 1) ||
				(text !== undefined && (typeof text !== "string" || text.length > limits.text))
			)
				throw new JobError("Choose from the offered options");
			if (!choices.length && !text) throw new JobError("Answer every question");
			return { choices: choices as string[], ...(text && { text }) };
		}),
	};
}

/**
 * Read an answer from the inbox form: `q<i>` holds the chosen labels and
 * `q<i>-text` the maintainer's own words.
 */
export function formAnswer(prompt: Prompt, form: Record<string, string | File | (string | File)[]>): Answer {
	const values = (name: string) => [form[name] ?? []].flat().filter((v): v is string => typeof v === "string");
	return parseAnswer(prompt, {
		answers: prompt.questions.map((_, i) => ({ choices: values(`q${i}`), text: values(`q${i}-text`)[0] })),
	});
}
