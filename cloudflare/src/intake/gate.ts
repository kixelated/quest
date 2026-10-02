import { evaluate, isClaimAddition } from "../core";
import type { readSnapshot } from "../snapshot";
import type { Fork } from "./registry";

type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
export interface FileChange {
	path: string;
	content: string | null;
}
export interface Accepted {
	kind: "claim" | "issue";
	file: FileChange;
}
export const maxMarkdownBytes = 64 * 1024;

function documents(snapshot: Snapshot): Map<string, string> {
	return new Map(snapshot.documents.map((document) => [document.path, document.content]));
}

export function plainMarkdown(content: string): boolean {
	return (
		content.length > 0 &&
		new TextEncoder().encode(content).length <= maxMarkdownBytes &&
		!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uFEFF]/u.test(content)
	);
}

// Compare the entire tree, not the event's possibly truncated commit list.
// Directory hashes change with a child, so only leaf entries are compared.
export function gate(before: Snapshot, after: Snapshot, upstream: Snapshot, fork: Fork): Accepted | null {
	try { return validate(before, after, upstream, fork); }
	catch { return null; } // Pure core rejection is invalid input, never a service retry.
}

function validate(before: Snapshot, after: Snapshot, upstream: Snapshot, fork: Fork): Accepted | null {
	const oldEntries = new Map(
		before.entries.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, entry]),
	);
	const newEntries = new Map(
		after.entries.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, entry]),
	);
	const changed = [...new Set([...oldEntries.keys(), ...newEntries.keys()])].filter((path) => {
		const old = oldEntries.get(path),
			next = newEntries.get(path);
		return !old || !next || old.hash !== next.hash || old.mode !== next.mode;
	});
	if (changed.length !== 1) return null;
	const path = changed[0],
		old = oldEntries.get(path),
		next = newEntries.get(path);
	if (!next || next.type !== "blob" || next.mode !== "100644") return null;
	const parts = path.split("/");
	for (let n = 1; n < parts.length; n++) {
		const parent = upstream.entries.find(entry=>entry.path===parts.slice(0,n).join("/"));
		if (parent && parent.type !== "tree") return null;
	}
	const oldDocs = documents(before),
		newDocs = documents(after),
		upstreamDocs = documents(upstream);
	const content = newDocs.get(path);
	if (content === undefined || !plainMarkdown(content)) return null;
	let kind: Accepted["kind"];
	if (/^issues\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path) && path.length <= 80) {
		if (old || upstream.entries.some((entry) => entry.path === path)) return null;
		kind = "issue";
	} else if (/^quest\/.+\.md$/.test(path)) {
		if (!old || old.type !== "blob" || old.mode !== "100644" || oldDocs.get(path) !== upstreamDocs.get(path))
			return null;
		const current = evaluate(upstream);
		if (current.findings.length || !current.ready.includes(path)) return null;
		const submitted = evaluate(after).claims[path];
		if (
			!submitted ||
			submitted.name !== fork.name ||
			submitted.provider !== fork.provider ||
			submitted.identity !== fork.identity ||
			submitted.location !== fork.remote
		)
			return null;
		// Intake accepts its own exact claim syntax; the core remains forge-extensible.
		if (
			submitted.text !==
			`${fork.name} (${fork.provider}:${fork.identity}) on ${fork.remote} since ${submitted.date}`
		)
			return null;
		if (!isClaimAddition(upstreamDocs.get(path)!, content)) return null;
		kind = "claim";
	} else return null;
	const candidate = {
		documents: [...upstreamDocs]
			.filter(([name]) => name !== path)
			.map(([path, content]) => ({ path, content }))
			.concat({ path, content }),
		paths: [...new Set([...upstream.paths, path])],
	};
	if (evaluate(candidate).findings.length) return null;
	return { kind, file: { path, content } };
}
