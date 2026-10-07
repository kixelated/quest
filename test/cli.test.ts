// The command line's own contract: output streams, exit codes, and arguments.

import { expect, test } from "vitest";

import { version } from "../package.json";
import { Tree, run } from "./fixture";

test("check reports the document count", () => {
	expect(Tree.baseline().run("check")).toEqual({ code: 0, stdout: "quest: 5 documents ok\n", stderr: "" });
});

test("check prints findings on stderr and fails", () => {
	const out = Tree.baseline().append("quest/m0/line/one.md", "\n## Requires\n").run("check");
	expect(out.code).toBe(1);
	expect(out.stdout).toBe("");
	expect(out.stderr).toContain("quest: quest/m0/line/one.md:7: unknown '## Requires'");
});

test("ready lists ready quests", () => {
	expect(Tree.baseline().run("ready")).toEqual({ code: 0, stdout: "quest/m0/line/one.md\n", stderr: "" });
});

// Blocked or not, ready exits 0: the blocker list on stdout is the result.
test("ready prints blockers on stdout and explains on stderr", () => {
	const out = Tree.baseline().run("ready", "/quest/m0/line/two.md");
	expect(out.code).toBe(0);
	expect(out.stdout).toBe("quest/m0/line/one.md\n");
	expect(out.stderr).toContain("quest: blocked by quest/m0/line/one.md\n");
	expect(out.stderr).toContain("quest: /quest/m0/line/two.md is blocked;");
});

test("ready accepts a filesystem path", () => {
	const tree = Tree.baseline();
	expect(tree.run("ready", `${tree.path}/quest/m0/line/two.md`).stdout).toBe("quest/m0/line/one.md\n");
});

test("ready rejects a path that is not a quest", () => {
	const out = Tree.baseline().run("ready", "nope.md");
	expect(out.code).toBe(1);
	expect(out.stderr).toMatch(/^quest: nope.md is not a quest document under .*\/quest\n$/);
});

test("the root option is accepted after the command", () => {
	const tree = Tree.baseline();
	expect(run("ready", "--root", tree.path).stdout).toBe("quest/m0/line/one.md\n");
});

test("version", () => {
	expect(run("--version")).toEqual({ code: 0, stdout: `quest ${version}\n`, stderr: "" });
});

test("skill lists every skill", () => {
	const out = run("skill");
	expect(out.code).toBe(0);
	expect(out.stdout).toMatch(/^start - /m);
});

test("skill rejects an unknown name", () => {
	const out = run("skill", "nope");
	expect(out.code).toBe(1);
	expect(out.stderr).toMatch(/^quest: no skill named nope \(have: audit, /);
});

test("usage errors exit 2", () => {
	expect(run("bogus").code).toBe(2);
	expect(run("skill", "--stub").code).toBe(2);
	expect(run("ready", "a", "b").code).toBe(2);
	expect(run().code).toBe(2);
});
