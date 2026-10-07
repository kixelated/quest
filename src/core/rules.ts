// The rules, and the findings they produce.
//
// The contract is the guide (`quest guide`). Every rule here is one that has
// already been broken by hand, and the expensive failure is a rule that stops
// firing: a validator that quietly enforces nothing looks exactly like a clean
// tree.
//
// The whole tree is validated on every run, never just the changed files: the
// link graph and the epic index are global, so completing one quest breaks
// files the diff never mentions. That is not hypothetical - it is how the index
// entry for a completed quest survived a rebase that produced no conflict at
// all.

import { parseClaim } from "./claim";
import { type Doc, entries, has, isEpic, children, owner, rooted, withoutFragment } from "./doc";
import { comparePaths, escapes, join, normalize, parent } from "./path";

/**
 * The `## ` headings a quest document may use. Readiness greps `## Required`
 * literally, so a typo turns a blocked quest ready and fails nowhere else: the
 * closed vocabulary is what catches it.
 */
const HEADINGS = ["Goal", "Plan", "Claim", "Required", "Closes", "Related"];
const SIZES = ["XS", "S", "M", "L", "XL"];

/**
 * Sections whose whole content is a list. A heading left standing after its
 * last entry was removed is a bug: an empty `Required` blocks its quest
 * forever.
 */
const LIST_SECTIONS = ["Required", "Closes", "Related"];

/** The permanent root epic; the one document nothing has to list. */
export const ROOT = "quest/README.md";

/** One violation, addressed like a compiler diagnostic: `path:line: message`. */
export interface Finding {
	/** Repository-relative document the violation is in. */
	path: string;
	/** 1-based line, when the violation has one; `null` for whole-file findings. */
	line: number | null;
	/** What is wrong, and often why the rule exists. */
	message: string;
}

/** `path:line: message`, or `path: message` for a whole-file finding. */
export function formatFinding(finding: Finding): string {
	return finding.line === null
		? `${finding.path}: ${finding.message}`
		: `${finding.path}:${finding.line}: ${finding.message}`;
}

function compareFindings(a: Finding, b: Finding): number {
	return (
		comparePaths(a.path, b.path) ||
		(a.line ?? 0) - (b.line ?? 0) ||
		(a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
	);
}

/**
 * Validate a whole tree. `docs` is every quest document, and `exists` reports
 * whether a repository-relative path (a file or a directory) exists, which is
 * how links outside the tree resolve. Returns every finding, sorted.
 */
export function check(docs: Doc[], exists: (path: string) => boolean): Finding[] {
	const found: Finding[] = [];
	const known = new Set(docs.map((d) => d.path));

	for (const doc of docs) {
		headings(found, doc);
		claim(found, doc);
		links(found, exists, known, doc);
	}

	index(found, known, docs);
	cycles(found, docs);

	return found.sort(compareFindings);
}

function claim(found: Finding[], doc: Doc) {
	const claims = doc.headings.filter((heading) => heading.text === "Claim");
	if (claims.length === 0) return;
	const listed = entries(doc, "Claim");
	if (claims.length !== 1 || listed.length !== 1 || doc.claimExtraContent) {
		found.push({
			path: doc.path,
			line: claims[0].line,
			message: "'## Claim' must contain exactly one list item in one section",
		});
		return;
	}
	if (!parseClaim(listed[0].text)) {
		found.push({
			path: doc.path,
			line: listed[0].line,
			message:
				"claim must name a claimant, (provider:identity), fork or branch, and date: Name (provider:identity) on location since YYYY-MM-DD",
		});
	}
}

function headings(found: Finding[], doc: Doc) {
	if (!isEpic(doc)) {
		const title = doc.title;
		const match = title ? /^\[([^\]]*?)\] (.*)$/s.exec(title.text) : null;
		const valid = title !== null && match !== null && title.literal && SIZES.includes(match[1]) && match[2] !== "";
		if (!valid) found.push({ path: doc.path, line: null, message: "quest title must be '# [XS|S|M|L|XL] Title'" });
	}

	if (!has(doc, "Goal")) found.push({ path: doc.path, line: null, message: "missing '## Goal'" });

	for (const heading of doc.headings) {
		// A setext underline and a decorated ``## `Required` `` both render as the
		// same heading, and this validator would treat the quest as blocked.
		// Readiness greps `^## Required$` literally and would call it READY.
		if (HEADINGS.includes(heading.text) && !heading.literal) {
			found.push({
				path: doc.path,
				line: heading.line,
				message: `'${heading.text}' must be written literally as '## ${heading.text}'; readiness greps that form and would not see this one`,
			});
		}
		if (!HEADINGS.includes(heading.text)) {
			found.push({
				path: doc.path,
				line: heading.line,
				message: `unknown '## ${heading.text}' (allowed: ${HEADINGS.join(", ")})`,
			});
		}
	}

	for (const heading of doc.headings) {
		if (LIST_SECTIONS.includes(heading.text) && entries(doc, heading.text).length === 0) {
			const why =
				heading.text === "Required"
					? "; an empty one blocks the quest forever, so remove the heading with its last entry"
					: "; remove the heading with its last entry";
			found.push({ path: doc.path, line: heading.line, message: `'## ${heading.text}' is empty${why}` });
		}
	}
}

function resolve(docPath: string, target: string): string {
	return target.startsWith("/") ? normalize(target.slice(1)) : join(parent(docPath), target);
}

function links(found: Finding[], exists: (path: string) => boolean, known: Set<string>, doc: Doc) {
	for (const link of doc.links) {
		if (link.target.includes("://") || link.target.startsWith("mailto:")) continue;
		const target = withoutFragment(link.target);
		if (target === "") continue;

		// A normalized path that still opens with `..` points above the
		// repository root. Testing whether it exists would follow it into
		// whatever sits beside the checkout, so the repo's own directory name (or
		// a sibling worktree) could make a broken link pass.
		const path = resolve(doc.path, target);
		if (escapes(path) || !exists(path)) {
			found.push({ path: doc.path, line: link.line, message: `link does not resolve: ${link.target}` });
			continue;
		}

		// Quests and epics reference each other with root-absolute links. A
		// relative one still renders, so nothing else would notice - but it is
		// invisible to the dependency graph below, which only speaks /quest/...
		if (known.has(path) && !link.target.startsWith("/")) {
			found.push({
				path: doc.path,
				line: link.line,
				message: `link to a quest must be root-absolute: ${link.target} (write /${path})`,
			});
		}

		// A `Required` entry opens with its quest link. moq-dev/moq.pro#1170
		// shipped a customer-gate sentence mentioning an epic mid-line, which
		// reads as context but IS a blocker, and so silently required all of c2.
		if (link.section === "Required" && known.has(path) && link.position !== "entry") {
			found.push({
				path: doc.path,
				line: link.line,
				message: `Required links ${link.target} mid-sentence; that reads as prose but IS a blocker - open the bullet with the link, or drop the link`,
			});
		}
	}
}

/**
 * Every document is listed by the epic it sits under, as a child in that
 * README's `Required`, and every `Required` entry is a quest, required once.
 *
 * A condition outside the repository (a release, a customer, a person) is a
 * quest of its own rather than a plain-text bullet: a blocked quest drops out
 * of every ready listing, so the condition would be forgotten, while its own
 * quest keeps surfacing as ready until someone clears it.
 */
function index(found: Finding[], known: Set<string>, docs: Doc[]) {
	const listed = new Set<string>();

	for (const doc of docs) {
		for (const child of children(doc)) listed.add(child);

		const seen = new Set<string>();
		for (const entry of entries(doc, "Required")) {
			const target = entry.target === null ? null : rooted(entry.target);
			if (target === null || !known.has(target)) {
				found.push({
					path: doc.path,
					line: entry.line,
					message: `requires ${entry.target ?? entry.text}, which is not a quest document; make an outside condition its own quest`,
				});
				continue;
			}
			if (seen.has(target)) {
				found.push({ path: doc.path, line: entry.line, message: `requires ${entry.target} twice` });
			}
			seen.add(target);
		}
	}

	for (const doc of docs) {
		// The root epic is permanent and has nothing above it to list it.
		if (doc.path === ROOT || listed.has(doc.path)) continue;
		found.push({
			path: doc.path,
			line: null,
			message: `not listed in ${join(owner(doc.path), "README.md")}'s '## Required'; an unlisted quest is unreachable`,
		});
	}
}

/**
 * `Required` must be acyclic. A cycle is a set of quests none of which can ever
 * start, and walking the links to rule one out is exactly the manual step an
 * author would otherwise take before adding a blocker. An epic requires its
 * children, so a quest requiring the epic that holds it is a cycle too.
 */
function cycles(found: Finding[], docs: Doc[]) {
	const blockers = new Map<string, string[]>();
	for (const doc of docs) {
		const edges = doc.links
			.filter((l) => l.section === "Required" && l.position === "entry")
			.map((l) => rooted(l.target))
			.filter((t): t is string => t !== null);
		blockers.set(doc.path, [...(blockers.get(doc.path) ?? []), ...edges]);
	}

	const state = new Map<string, "open" | "done">();
	const walk = (node: string, stack: string[]) => {
		const seen = state.get(node);
		if (seen === "done") return;
		if (seen === "open") {
			const from = Math.max(0, stack.indexOf(node));
			found.push({
				path: node,
				line: null,
				message: `Required cycle: ${[...stack.slice(from), node].join(" -> ")}`,
			});
			return;
		}
		state.set(node, "open");
		stack.push(node);
		for (const next of blockers.get(node) ?? []) walk(next, stack);
		stack.pop();
		state.set(node, "done");
	};

	for (const doc of docs) walk(doc.path, []);
}
