// Whether a quest can be started, read from the same `Required` and `Claim`
// sections the rules validate.
//
// Readiness is a property of the tree alone, which is what makes it cheap and
// deterministic: a finished quest is deleted, so a blocker that still resolves
// is still open. Liveness is the other question - a quest can be ready,
// coherent, and already done by some other PR - and answering it means asking
// the forge, so it belongs to the flow that is already talking to it.

import { type Doc, type Entry, children, entries, has, isEpic, rooted } from "./doc";
import { comparePaths, normalize } from "./path";
import { ROOT } from "./rules";

/** One thing standing between a quest and being started. */
export interface Blocker {
	/**
	 * The quest or epic that has to finish first. `null` is an entry that
	 * is not a quest, which `quest check` rejects and nothing here can clear.
	 */
	path: string | null;
	/** The dependency or claim as written, whitespace collapsed. */
	text: string;
	/**
	 * The still-open quests under a required epic, which is what a
	 * epic blocker actually means. Empty for every other blocker: a
	 * required quest's own blockers are its readiness, not this one's.
	 */
	blockers: Blocker[];
}

/** What names the blocker: the document, or the entry's own words. */
export function label(blocker: Blocker): string {
	return blocker.path ?? blocker.text;
}

/** The whole chain, one blocker per line, indented two spaces per level of nesting. */
export function renderBlocker(blocker: Blocker, depth = 0): string[] {
	return [`${"  ".repeat(depth)}${label(blocker)}`, ...blocker.blockers.flatMap((b) => renderBlocker(b, depth + 1))];
}

/**
 * What blocks `path`, a required epic expanded into the quests it still
 * holds. Empty means ready; `null` means `path` is not a quest document.
 *
 * `path` is the quest as the tree writes it (`/quest/a0/one.md`) or as the
 * shell completes it (`quest/a0/one.md`).
 */
export function blockers(docs: Doc[], path: string): Blocker[] | null {
	const byPath = new Map(docs.map((d) => [d.path, d]));
	const found = [normalize(path), normalize(path.replace(/^\//, ""))].find((p) => byPath.has(p));
	if (found === undefined) return null;
	return expand(byPath, byPath.get(found)!, [found]);
}

/**
 * Every quest that can be started now, in tree order: the root's `Required`
 * walked depth first, then any quest no epic lists, by path.
 *
 * An epic is not listed while it still requires children; a README with
 * none left is the epic's own remaining work and lists like any other quest.
 * A quest is ready when it has neither a `## Required` nor a `## Claim` heading.
 */
export function ready(docs: Doc[]): string[] {
	const sorted = [...docs].sort((a, b) => comparePaths(a.path, b.path));
	const remaining = new Map(sorted.map((doc) => [doc.path, doc]));
	const open = (doc: Doc) => !has(doc, "Required") && !has(doc, "Claim");
	const pending = [ROOT];
	const found: string[] = [];
	for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
		const doc = remaining.get(path);
		if (!doc) continue;
		remaining.delete(path);
		if (isEpic(doc)) {
			pending.push(...children(doc).reverse());
		} else if (open(doc)) {
			found.push(path);
		}
	}
	for (const doc of remaining.values()) {
		if (!isEpic(doc) && open(doc)) found.push(doc.path);
	}
	return found;
}

/** The blockers of one document: its `Required` entries, which for an epic include its children. */
function expand(byPath: Map<string, Doc>, doc: Doc, stack: string[]): Blocker[] {
	const found: Blocker[] = [];
	if (has(doc, "Claim")) {
		const [claim] = entries(doc, "Claim");
		found.push({
			path: null,
			text: claim
				? `claimed by ${claim.text}`
				: "an empty '## Claim' section, which blocks the quest until the heading is removed",
			blockers: [],
		});
	}
	// A heading left standing after its last blocker still reads as blocked to
	// everything that greps for it, including `quest check`, which reports it.
	// Calling it ready here would make this the one tool that disagrees.
	const required = entries(doc, "Required");
	if (has(doc, "Required") && required.length === 0) {
		found.push({
			path: null,
			text: "an empty '## Required' section, which blocks the quest until the heading is removed",
			blockers: [],
		});
	}
	for (const entry of required) found.push(blocker(byPath, entry, stack));
	return found;
}

function blocker(byPath: Map<string, Doc>, entry: Entry, stack: string[]): Blocker {
	// A bullet that does not open with a link into the tree is invalid, and
	// nothing here can clear it, so it is a blocker with nothing under it.
	const target = entry.target === null ? null : rooted(entry.target);
	const path = target !== null && byPath.has(target) ? target : null;

	// Only an epic expands. A required QUEST is the blocker itself, and its
	// own chain is the answer to running this on that quest instead; printing
	// it here buries the entries that were asked for under a repeated subtree.
	// The stack guard is for a tree nobody has run `quest check` on yet, where a
	// epic listing an ancestor must print rather than recurse forever.
	let nested: Blocker[] = [];
	if (path !== null && isEpic(byPath.get(path)!) && !stack.includes(path)) {
		stack.push(path);
		nested = expand(byPath, byPath.get(path)!, stack);
		stack.pop();
	}
	return { path, text: entry.text, blockers: nested };
}
