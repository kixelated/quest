// The command line's own contract: output streams, exit codes, and arguments.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { version } from "../package.json";
import { Tree, run, tempDir } from "./fixture";

test("check reports the document count", () => {
	expect(Tree.baseline().run("check")).toEqual({ code: 0, stdout: "quest: 5 documents ok\n", stderr: "" });
});

test("check prints findings on stderr and fails", () => {
	const out = Tree.baseline().append("quest/a0/epic/one.md", "\n## Requires\n").run("check");
	expect(out.code).toBe(1);
	expect(out.stdout).toBe("");
	expect(out.stderr).toContain("quest: quest/a0/epic/one.md:7: unknown '## Requires'");
});

test("ready lists ready quests", () => {
	expect(Tree.baseline().run("ready")).toEqual({ code: 0, stdout: "quest/a0/epic/one.md\n", stderr: "" });
});

// Blocked or not, ready exits 0: the blocker list on stdout is the result.
test("ready prints blockers on stdout and explains on stderr", () => {
	const out = Tree.baseline().run("ready", "/quest/a0/epic/two.md");
	expect(out.code).toBe(0);
	expect(out.stdout).toBe("quest/a0/epic/one.md\n");
	expect(out.stderr).toContain("quest: blocked by quest/a0/epic/one.md\n");
	expect(out.stderr).toContain("quest: /quest/a0/epic/two.md is blocked;");
});

test("ready accepts a filesystem path", () => {
	const tree = Tree.baseline();
	expect(tree.run("ready", `${tree.path}/quest/a0/epic/two.md`).stdout).toBe("quest/a0/epic/one.md\n");
});

test("ready rejects a path that is not a quest", () => {
	const out = Tree.baseline().run("ready", "nope.md");
	expect(out.code).toBe(1);
	expect(out.stderr).toMatch(/^quest: nope.md is not a quest document under .*\/quest\n$/);
});

test("the root option is accepted after the command", () => {
	const tree = Tree.baseline();
	expect(run("ready", "--root", tree.path).stdout).toBe("quest/a0/epic/one.md\n");
});

test("init and uninstall print each changed path and nothing else", () => {
	const root = tempDir();
	const init = run("--root", root, "init");
	expect(init.code).toBe(0);
	expect(init.stdout).toMatch(/^(\S+\n)+$/);
	expect(init.stdout).toContain("quest/README.md\nAGENTS.md\n");
	expect(run("--root", root, "init").stdout).toBe("");
	expect(run("--root", root, "uninstall").stdout).toMatch(/^(\S+\n)+$/);
	expect(run("--root", root, "uninstall").stdout).toBe("");
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

test("an empty root is a usage error", () => {
	expect(run("--root", "", "check").code).toBe(2);
});

test("a missing tree names the directory as given", () => {
	const out = run("--root", "./nonexistent", "check");
	expect(out.code).toBe(1);
	expect(out.stderr).toMatch(/^quest: scanning \.\/nonexistent\/quest: ENOENT/);
});

test("a document that is not UTF-8 is an error", () => {
	const tree = Tree.baseline();
	writeFileSync(join(tree.path, "quest/a0/epic/one.md"), Buffer.from([0x23, 0x20, 0xff, 0x0a]));
	const out = tree.run("check");
	expect(out.code).toBe(1);
	expect(out.stderr).toMatch(/^quest: reading quest\/a0\/epic\/one\.md: /);
});
