// Rank ready work without mistaking the epic index for downstream work.

import { type Doc, children, entries, permanent, rooted } from "./doc";
import { ready } from "./ready";
import { ROOT, check, formatFinding } from "./rules";

export interface RankedQuest {
	path: string;
	/** Distinct transitive dependents; other prerequisites may still remain. */
	dependents: number;
}

/**
 * Milestone order, descending downstream impact, then existing ready order.
 * Validates the graph and document structure; callers validate filesystem links.
 * Readiness and impact are local facts, independent of claims or outside conditions.
 */
export function unblocked(docs: Doc[]): RankedQuest[] {
	const findings = check(docs, () => true);
	if (findings.length > 0) throw new Error(findings.map(formatFinding).join("\n"));

	const byPath = new Map(docs.map((doc) => [doc.path, doc]));
	const reverse = new Map<string, { path: string; structural: boolean }[]>();
	for (const doc of docs) {
		const members = new Set(children(doc));
		for (const entry of entries(doc, "Required")) {
			const target = rooted(entry.target!)!;
			const dependents = reverse.get(target) ?? [];
			dependents.push({ path: doc.path, structural: members.has(target) });
			reverse.set(target, dependents);
		}
	}

	// Assign the root's subtrees their priority before scoring. In particular,
	// many later-milestone dependents cannot promote a later candidate.
	const priority = new Map<string, number>();
	const assign = (path: string, rank: number) => {
		if (priority.has(path)) return;
		priority.set(path, rank);
		const doc = byPath.get(path);
		if (doc) for (const child of children(doc)) assign(child, rank);
	};
	const root = byPath.get(ROOT);
	if (root) children(root).forEach(assign);

	const impact = (path: string): number => {
		const visited = new Set([path]);
		const dependents = new Set<string>();
		const pending = [path];
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			for (const edge of reverse.get(next) ?? []) {
				if (!edge.structural && !permanent(edge.path) && edge.path !== path) dependents.add(edge.path);
				// Membership does not score, but traversing it lets a real
				// dependency on an epic reach that epic's remaining work.
				if (visited.has(edge.path)) continue;
				visited.add(edge.path);
				pending.push(edge.path);
			}
		}
		return dependents.size;
	};

	return ready(docs)
		.map((path) => ({ path, dependents: impact(path) }))
		.sort(
			(a, b) =>
				(priority.get(a.path) ?? Infinity) - (priority.get(b.path) ?? Infinity) || b.dependents - a.dependents,
		);
}
