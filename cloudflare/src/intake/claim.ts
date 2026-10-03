import type { Actor } from "./registry";

// Parentheses delimit the Claim identity envelope; preserve them visually using
// fullwidth forms. Markdown punctuation is escaped when rendering the template.
export function claimDisplayName(name: string): string {
	return name
		.replace(/[\x00-\x1f\x7f\uFEFF]/g, " ")
		.replaceAll("<", "＜")
		.replaceAll(">", "＞")
		.replaceAll("(", "（")
		.replaceAll(")", "）")
		.replace(/\s+/gu, " ")
		.trim();
}
export function claimMarkdownName(name: string): string {
	return name.replace(/[\\<>`*_{}\[\]()#+.!|~-]/g, "\\$&");
}

// Never publish the login email. Credit the verified forge identity explicitly
// and derive a stable no-reply address without assuming a provider ID alphabet.
export async function creditAuthor(
	actor: Pick<Actor, "name" | "provider" | "identity">,
): Promise<{ name: string; email: string }> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${actor.provider}\0${actor.identity}`)),
	);
	const id = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return {
		name: claimDisplayName(`${actor.name} [${actor.provider}:${actor.identity}]`),
		email: `${id}@users.quest.invalid`,
	};
}
