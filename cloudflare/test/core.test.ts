import { check, parse, ready } from "quest/core";
import { describe, expect, it } from "vitest";

// The Worker shares the CLI's core. This runs it inside workerd, which has no
// filesystem, to keep it free of Node APIs.
describe("quest/core", () => {
	it("checks a tree and finds ready work", () => {
		const docs = [
			parse("quest/README.md", "# Quests\n\n## Goal\n\nShip it.\n\n## Required\n\n- [One](/quest/one.md)\n"),
			parse("quest/one.md", "# [S] One\n\n## Goal\n\nThe first quest.\n"),
		];
		const paths = new Set(docs.map((doc) => doc.path));
		expect(check(docs, (path) => paths.has(path))).toEqual([]);
		expect(ready(docs)).toEqual(["quest/one.md"]);
	});
});
