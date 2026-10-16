import { expect, test } from "vitest";

import { type Doc, owner, parse, ready, unblocked } from "../src/core";

/** A valid indexed tree, with insertion order defining each epic's priorities. */
function graph(spec: Record<string, string[]>, milestones = ["m0"]): Doc[] {
	const index = new Map<string, string[]>([
		["quest/README.md", milestones.map((name) => `quest/${name}/README.md`)],
		...milestones.map((name) => [`quest/${name}/README.md`, []] as [string, string[]]),
	]);
	const add = (path: string) => {
		if (path === "quest/README.md") return;
		const parent = `${owner(path)}/README.md`;
		if (!index.has(parent)) {
			index.set(parent, []);
			add(parent);
		}
		const children = index.get(parent)!;
		if (!children.includes(path)) children.push(path);
	};
	for (const name of Object.keys(spec)) add(`quest/${name}`);
	const paths = new Set([...index.keys(), ...Object.keys(spec).map((name) => `quest/${name}`)]);
	return [...paths].map((path) => {
		const dependencies = [
			...(index.get(path) ?? []),
			...(spec[path.slice(6)] ?? []).map((name) => `quest/${name}`),
		];
		return parse(
			path,
			`# ${index.has(path) ? "Epic" : "[S] Work"}\n\n## Goal\n\nWork.\n` +
				(dependencies.length
					? `\n## Required\n\n${dependencies.map((dep) => `- [Work](/${dep})`).join("\n")}\n`
					: ""),
		);
	});
}

test("ranks chains ahead of zero-impact work without changing ready", () => {
	const docs = graph({ "m0/zero.md": [], "m0/a.md": [], "m0/b.md": ["m0/a.md"], "m0/c.md": ["m0/b.md"] });
	expect(ready(docs)).toEqual(["quest/m0/zero.md", "quest/m0/a.md"]);
	expect(unblocked(docs)).toEqual([
		{ path: "quest/m0/a.md", dependents: 2 },
		{ path: "quest/m0/zero.md", dependents: 0 },
	]);
});

test("deduplicates diamonds and counts work that still has another prerequisite", () => {
	const docs = graph({
		"m0/a.md": [],
		"m0/other.md": [],
		"m0/b.md": ["m0/a.md", "m0/other.md"],
		"m0/c.md": ["m0/a.md"],
		"m0/d.md": ["m0/b.md", "m0/c.md"],
	});
	expect(unblocked(docs)).toEqual([
		{ path: "quest/m0/a.md", dependents: 3 },
		{ path: "quest/m0/other.md", dependents: 2 },
	]);
});

test("does not score membership, but reaches real dependents of nested epics", () => {
	const docs = graph({
		"m0/epic/nested/a.md": [],
		"m0/epic/nested/b.md": ["m0/epic/nested/a.md"],
		"m0/epic/zero.md": [],
		"m0/outside.md": ["m0/epic/README.md"],
	});
	expect(unblocked(docs)).toEqual([
		{ path: "quest/m0/epic/nested/a.md", dependents: 2 },
		{ path: "quest/m0/epic/zero.md", dependents: 1 },
	]);
	const membership = graph({ "m0/epic/nested/a.md": [], "m0/epic/zero.md": [] });
	expect(unblocked(membership).map((quest) => quest.dependents)).toEqual([0, 0]);
});

test("retains an epic's real prerequisites alongside its children", () => {
	const docs = graph({
		"m0/a.md": [],
		"m0/epic/child.md": [],
		"m0/epic/README.md": ["m0/a.md"],
		"m0/outside.md": ["m0/epic/README.md"],
	});
	expect(unblocked(docs)).toEqual([
		{ path: "quest/m0/a.md", dependents: 2 },
		{ path: "quest/m0/epic/child.md", dependents: 1 },
	]);
});

test("root milestone order wins over impact, counting later-milestone dependents", () => {
	const docs = graph(
		{
			"m0/early.md": [],
			"m1/later.md": [],
			"m1/a.md": ["m1/later.md"],
			"m1/b.md": ["m1/later.md"],
			"m1/c.md": ["m0/early.md"],
		},
		["m0", "m1"],
	);
	expect(unblocked(docs)).toEqual([
		{ path: "quest/m0/early.md", dependents: 1 },
		{ path: "quest/m1/later.md", dependents: 2 },
	]);
	expect(unblocked(docs.slice().reverse())).toEqual(unblocked(docs));
	const reordered = graph({ "m0/a.md": [], "m1/b.md": [] }, ["m1", "m0"]);
	expect(unblocked(reordered).map((quest) => quest.path)).toEqual(["quest/m1/b.md", "quest/m0/a.md"]);
});

test("breaks ties in existing tree order and treats a completed epic as work", () => {
	const docs = graph({ "m0/z.md": [], "m0/finished/README.md": [], "m0/a.md": [] });
	expect(unblocked(docs)).toEqual(ready(docs).map((path) => ({ path, dependents: 0 })));
	expect(unblocked(docs).map((quest) => quest.path)).toEqual([
		"quest/m0/z.md",
		"quest/m0/finished/README.md",
		"quest/m0/a.md",
	]);
});

test("rejects invalid graphs rather than emitting a plausible ranking", () => {
	expect(() => unblocked(graph({ "m0/a.md": ["m0/b.md"], "m0/b.md": ["m0/a.md"] }))).toThrow("Required cycle");
	expect(() => unblocked(graph({ "m0/a.md": ["m0/missing.md"] }))).toThrow("not a quest document");
});
