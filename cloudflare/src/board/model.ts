// The board's reading of a project: acts, epics, and quests, each with its
// status and progress. Readiness comes from the shared core, so the board
// always agrees with `quest ready`.

import {
	type Doc,
	ROOT,
	blockers,
	children,
	comparePaths,
	entries,
	isEpic,
	parse,
	parseClaim,
	permanent,
	ready,
} from "quest/core";
import type { Size } from "../layout";
import type { Change, Completed, Project } from "./project";

/**
 * A quest's most advanced state, per design/theme.md: Ready to turn in, then
 * Accepted by, then Available or Requires.
 */
export type Status =
	| { kind: "turn-in"; change: Change }
	| { kind: "accepted"; by: string; since: string | null }
	| { kind: "available" }
	| { kind: "blocked"; requires: Ref[] };

/** A link to another quest, or a blocker's own words when it names none. */
export type Ref = { title: string; href: string | null };

export type Quest = {
	path: string;
	href: string;
	title: string;
	size: Size | null;
	status: Status;
};

/** Finished work out of all work, by count and weighted by difficulty. */
export type Progress = { done: number; total: number; weight: number; totalWeight: number };

/** An act or epic: a directory of quests, listed in priority order. */
export type Group = {
	path: string;
	href: string;
	title: string;
	progress: Progress;
	items: Item[];
};

export type Item = { kind: "quest"; quest: Quest } | { kind: "epic"; epic: Group };

export type Act = Group & { number: string; summary: string };

export type Finished = Completed & { href: string | null; name: string; size: Size | null; act: string | null };

export type Board = {
	project: Project;
	summary: string;
	acts: Act[];
	counts: Record<Status["kind"], number>;
	finished: Finished[];
	docs: Map<string, Doc>;
	quests: Map<string, Quest>;
};

// Story points: the size ladder grows faster than linearly.
const WEIGHTS: Record<Size, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

/** A `[S] Title` heading split into its size and its name. */
export function title(text: string): { size: Size | null; name: string } {
	const match = /^\[(XS|S|M|L|XL)\]\s+(.*)$/.exec(text);
	return match ? { size: match[1] as Size, name: match[2] } : { size: null, name: text };
}

/**
 * A quest's page: its path without `.md`, like its branch name. A README is
 * its directory's page.
 */
export function questHref(project: Project, path: string): string {
	if (path === ROOT) return `/repos/${project.name}`;
	const page = path.replace(/\/README\.md$/, "").replace(/\.md$/, "");
	return `/repos/${project.name}/${page}`;
}

/** An act's section on its board page: its directory name, such as `a0`. */
export function actAnchor(act: Act): string {
	return act.path.split("/")[1] ?? "unsorted";
}

/** The document a page path names: `quest/a0/board`, `quest/a0/epic`, or `quest/a0/epic/README`. */
export function findDoc(board: Board, page: string): Doc | null {
	for (const path of [`${page}.md`, `${page}/README.md`]) {
		const doc = board.docs.get(path);
		if (doc) return doc;
	}
	return null;
}

/** The first paragraph of a section, as plain words. */
export function lead(content: string, section: string): string {
	const body = content.split(new RegExp(`^## ${section}$`, "m"))[1]?.split(/^## /m)[0] ?? "";
	const paragraph = body.trim().split(/\n\s*\n/)[0] ?? "";
	return paragraph
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function readBoard(project: Project): Board {
	const sorted = [...project.documents].sort((a, b) => comparePaths(a.path, b.path));
	const parsed = sorted.map(({ path, content }) => parse(path, content));
	const docs = new Map(parsed.map((doc) => [doc.path, doc]));
	const contents = new Map(sorted.map(({ path, content }) => [path, content]));
	const open = new Set(ready(parsed));
	const changes = new Map(project.changes.map((change) => [change.quest, change]));

	const name = (path: string) => {
		const doc = docs.get(path);
		return doc?.title ? title(doc.title.text).name : path;
	};

	const status = (doc: Doc): Status => {
		const change = changes.get(doc.path);
		if (change) return { kind: "turn-in", change };
		const [claim] = entries(doc, "Claim");
		if (claim) {
			const parsed = parseClaim(claim.text);
			if (!parsed) return { kind: "accepted", by: claim.text, since: null };
			const by = parsed.provider === "github" ? `@${parsed.identity}` : parsed.name;
			return { kind: "accepted", by, since: parsed.since };
		}
		if (open.has(doc.path)) return { kind: "available" };
		const requires = blockers(parsed, doc)
			.filter((blocker) => blocker.path !== null || !blocker.text.startsWith("claimed by "))
			.map((blocker) =>
				blocker.path === null
					? { title: blocker.text, href: null }
					: { title: name(blocker.path), href: questHref(project, blocker.path) },
			);
		return { kind: "blocked", requires };
	};

	const quest = (doc: Doc): Quest => {
		const parsed = title(doc.title?.text ?? doc.path);
		return {
			path: doc.path,
			href: questHref(project, doc.path),
			title: parsed.name,
			size: parsed.size,
			status: status(doc),
		};
	};

	const dir = (path: string) => path.replace(/\/README\.md$/, "");
	const finishedUnder = (path: string) => project.completed.filter((c) => c.path.startsWith(`${dir(path)}/`));

	const progress = (path: string): Progress => {
		const under = (p: string) => p.startsWith(`${dir(path)}/`);
		const remaining = parsed.filter((doc) => under(doc.path) && !isEpic(doc));
		const done = finishedUnder(path);
		const weigh = (titles: string[]) => titles.reduce((sum, text) => sum + WEIGHTS[title(text).size ?? "XS"], 0);
		const weight = weigh(done.map((c) => c.title));
		return {
			done: done.length,
			total: done.length + remaining.length,
			weight,
			totalWeight: weight + weigh(remaining.map((doc) => doc.title?.text ?? "")),
		};
	};

	// A group's items are its children in priority order, then anything under
	// it that no README lists, so nothing in the tree goes unseen.
	const seen = new Set<string>([ROOT]);
	const group = (doc: Doc): Group => {
		seen.add(doc.path);
		const listed = children(doc).filter((path) => docs.has(path) && !seen.has(path));
		const base = dir(doc.path);
		const loose = parsed
			.map((d) => d.path)
			.filter((path) => !listed.includes(path) && !seen.has(path) && direct(base, path));
		const items = [...listed, ...loose].flatMap((path): Item[] => {
			if (seen.has(path)) return [];
			seen.add(path);
			const child = docs.get(path)!;
			return isEpic(child) ? [{ kind: "epic", epic: group(child) }] : [{ kind: "quest", quest: quest(child) }];
		});
		return {
			path: doc.path,
			href: questHref(project, doc.path),
			title: name(doc.path),
			progress: progress(doc.path),
			items,
		};
	};

	const root = docs.get(ROOT);
	const actPaths = [...(root ? children(root) : []), ...parsed.map((doc) => doc.path)].filter(
		(path, i, all) => path !== ROOT && permanent(path) && docs.has(path) && all.indexOf(path) === i,
	);
	const acts = actPaths.map((path): Act => {
		const segment = path.split("/")[1];
		return {
			...group(docs.get(path)!),
			number: /^[a-z](\d+)$/.exec(segment)?.[1] ?? segment,
			summary: lead(contents.get(path) ?? "", "Goal"),
		};
	});

	// Quests outside every act still show, in a group of their own.
	const rest = parsed.filter((doc) => !seen.has(doc.path) && !isEpic(doc)).map(quest);
	if (rest.length > 0) {
		acts.push({
			path: "quest",
			href: questHref(project, ROOT),
			title: "Unsorted",
			number: "",
			summary: "Quests that no act lists.",
			progress: { done: 0, total: rest.length, weight: 0, totalWeight: 0 },
			items: rest.map((quest) => ({ kind: "quest", quest })),
		});
	}

	const all = acts.flatMap((act) => flatten(act.items));
	const counts = { "turn-in": 0, accepted: 0, available: 0, blocked: 0 };
	for (const q of all) counts[q.status.kind]++;

	const actOf = (path: string) => acts.find((c) => c.number !== "" && path.startsWith(`${dir(c.path)}/`));
	const finished = project.completed.map((c): Finished => {
		const parsed = title(c.title);
		const act = actOf(c.path);
		return {
			...c,
			name: parsed.name,
			size: parsed.size,
			act: act ? `Act ${act.number}` : null,
			href: project.web ? `${project.web}/commit/${c.commit}` : null,
		};
	});

	return {
		project,
		summary: lead(contents.get(ROOT) ?? "", "Goal"),
		acts,
		counts,
		finished,
		docs,
		quests: new Map(all.map((q) => [q.path, q])),
	};
}

/** Whether `path` sits directly in `dir`: a quest file, or an epic's README one level down. */
function direct(dir: string, path: string): boolean {
	const rest = path.slice(dir.length + 1);
	if (!path.startsWith(`${dir}/`)) return false;
	const parts = rest.split("/");
	return parts.length === 1 ? parts[0] !== "README.md" : parts.length === 2 && parts[1] === "README.md";
}

/** Only the quests with this status, dropping epics left empty. */
export function only(items: Item[], kind: Status["kind"]): Item[] {
	return items.flatMap((item): Item[] => {
		if (item.kind === "quest") return item.quest.status.kind === kind ? [item] : [];
		const kept = only(item.epic.items, kind);
		return kept.length > 0 ? [{ kind: "epic", epic: { ...item.epic, items: kept } }] : [];
	});
}

export function flatten(items: Item[]): Quest[] {
	return items.flatMap((item) => (item.kind === "quest" ? [item.quest] : flatten(item.epic.items)));
}

/** The groups that hold a document, outermost first: its act, then any epics. */
export function trail(board: Board, path: string): Group[] {
	const found: Group[] = [];
	const visit = (group: Group): boolean =>
		group.items.some((item) => {
			if (item.kind === "quest") return item.quest.path === path;
			if (item.epic.path === path) return true;
			if (!visit(item.epic)) return false;
			found.unshift(item.epic);
			return true;
		});
	const act = board.acts.find((act) => act.path !== path && visit(act));
	return act ? [act, ...found] : [];
}

/** The group a document heads, if it is an act or an epic. */
export function findGroup(board: Board, path: string): Group | null {
	const search = (groups: Group[]): Group | null => {
		for (const group of groups) {
			if (group.path === path) return group;
			const epics = group.items.flatMap((item) => (item.kind === "epic" ? [item.epic] : []));
			const found = search(epics);
			if (found) return found;
		}
		return null;
	};
	return search(board.acts);
}
