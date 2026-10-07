// Themed output on a terminal. Piped output is the plain contract, pinned in
// cli.test.ts; these cover only what a terminal sees.

import { describe, expect, test } from "vitest";

import { detect } from "../src/cli/theme";
import { A0_README, ROOT_README, Tree, tempDir, runOn } from "./fixture";

const COLOUR = { colour: true };
const NO_COLOUR = { colour: false };

/** `text` in SGR colour `sgr`, as the theme writes it. */
const sgr = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`;

/** One quest of every size under one epic, none blocked. */
function sizes(): Tree {
	return new Tree()
		.write("quest/README.md", ROOT_README)
		.write("quest/a0/README.md", A0_README)
		.write(
			"quest/a0/epic/README.md",
			"# Epic\n\n## Goal\n\nAn epic.\n\n## Required\n\n" +
				["xs", "s", "m", "l", "xl"].map((name) => `- [${name}](/quest/a0/epic/${name}.md)\n`).join(""),
		)
		.write("quest/a0/epic/xs.md", "# [XS] Tiny\n\n## Goal\n\nA quest.\n")
		.write("quest/a0/epic/s.md", "# [S] Small\n\n## Goal\n\nA quest.\n")
		.write("quest/a0/epic/m.md", "# [M] Medium\n\n## Goal\n\nA quest.\n")
		.write("quest/a0/epic/l.md", "# [L] Large\n\n## Goal\n\nA quest.\n")
		.write("quest/a0/epic/xl.md", "# [XL] Huge\n\n## Goal\n\nA quest.\n");
}

describe("detect", () => {
	test("a pipe is not a terminal", () => {
		expect(detect(undefined, {})).toBeUndefined();
		expect(detect(false, {})).toBeUndefined();
	});

	test("a terminal is coloured unless NO_COLOR is set and non-empty", () => {
		expect(detect(true, {})).toEqual({ colour: true });
		expect(detect(true, { NO_COLOR: "" })).toEqual({ colour: true });
		expect(detect(true, { NO_COLOR: "1" })).toEqual({ colour: false });
	});
});

describe("ready", () => {
	test("lists available quests with a yellow marker and size colours", () => {
		const bang = sgr("33", "!");
		expect(sizes().runOn(COLOUR, "ready")).toEqual({
			code: 0,
			stdout:
				"5 quests available\n" +
				`${bang} ${sgr("90", "[XS]")} Tiny   quest/a0/epic/xs.md\n` +
				`${bang} ${sgr("32", "[S]")} Small   quest/a0/epic/s.md\n` +
				`${bang} ${sgr("33", "[M]")} Medium  quest/a0/epic/m.md\n` +
				`${bang} ${sgr("31", "[L]")} Large   quest/a0/epic/l.md\n` +
				`${bang} ${sgr("35", "[XL]")} Huge   quest/a0/epic/xl.md\n`,
			stderr: "",
		});
	});

	test("NO_COLOR keeps the layout and drops the escape codes", () => {
		expect(sizes().runOn(NO_COLOUR, "ready").stdout).toBe(
			"5 quests available\n" +
				"! [XS] Tiny   quest/a0/epic/xs.md\n" +
				"! [S] Small   quest/a0/epic/s.md\n" +
				"! [M] Medium  quest/a0/epic/m.md\n" +
				"! [L] Large   quest/a0/epic/l.md\n" +
				"! [XL] Huge   quest/a0/epic/xl.md\n",
		);
	});

	test("says so when nothing is available", () => {
		const tree = Tree.baseline().append(
			"quest/a0/epic/one.md",
			"\n## Claim\n\n- Jane Doe (github:jdoe) on jdoe/quest since 2026-10-02\n",
		);
		expect(tree.runOn(NO_COLOUR, "ready").stdout).toBe(
			"No quests available: every open quest is blocked or accepted.\n",
		);
	});

	test("one quest reads in the singular", () => {
		expect(Tree.baseline().runOn(NO_COLOUR, "ready").stdout).toBe(
			"1 quest available\n! [S] One  quest/a0/epic/one.md\n",
		);
	});
});

describe("ready <path>", () => {
	test("an available quest", () => {
		expect(Tree.baseline().runOn(COLOUR, "ready", "quest/a0/epic/one.md")).toEqual({
			code: 0,
			stdout: `${sgr("33", "!")} ${sgr("32", "[S]")} One  quest/a0/epic/one.md\n  Available\n`,
			stderr: "",
		});
	});

	test("a blocked quest shows a grey marker and what it requires", () => {
		const out = Tree.baseline().runOn(COLOUR, "ready", "/quest/a0/epic/two.md");
		expect(out.code).toBe(0);
		expect(out.stdout).toBe(
			`${sgr("90", "!")} ${sgr("32", "[S]")} Two    quest/a0/epic/two.md\n` +
				"  Requires:\n" +
				`    ${sgr("32", "[S]")} One  quest/a0/epic/one.md\n`,
		);
		// The log names the blockers, so stderr keeps only the advice.
		expect(out.stderr).not.toContain("blocked by");
		expect(out.stderr).toContain("quest: /quest/a0/epic/two.md is blocked;");
	});

	test("a required epic expands into the quests it still holds", () => {
		const out = Tree.baseline().runOn(NO_COLOUR, "ready", "quest/a0/README.md");
		expect(out.stdout).toBe(
			"! A0           quest/a0/README.md\n" +
				"  Requires:\n" +
				"    Epic       quest/a0/epic/README.md\n" +
				"      [S] One  quest/a0/epic/one.md\n" +
				"      [S] Two  quest/a0/epic/two.md\n",
		);
	});

	test("a claimed quest is accepted, with no marker", () => {
		const tree = Tree.baseline().append(
			"quest/a0/epic/two.md",
			"\n## Claim\n\n- Jane Doe (github:jdoe) on jdoe/quest since 2026-10-02\n",
		);
		expect(tree.runOn(NO_COLOUR, "ready", "quest/a0/epic/two.md").stdout).toBe(
			"  [S] Two    quest/a0/epic/two.md\n" +
				"  Accepted by @jdoe since 2026-10-02\n" +
				"  Requires:\n" +
				"    [S] One  quest/a0/epic/one.md\n",
		);
	});

	test("a claimant outside GitHub is named", () => {
		const tree = Tree.baseline().append(
			"quest/a0/epic/one.md",
			"\n## Claim\n\n- Jane Doe (forgejo:jane) on jane/quest since 2026-10-02\n",
		);
		expect(tree.runOn(NO_COLOUR, "ready", "quest/a0/epic/one.md").stdout).toBe(
			"  [S] One  quest/a0/epic/one.md\n  Accepted by Jane Doe since 2026-10-02\n",
		);
	});

	test("an entry that is not a quest prints as written", () => {
		const tree = Tree.baseline().append("quest/a0/epic/one.md", "\n## Required\n\n- the design review\n");
		expect(tree.runOn(NO_COLOUR, "ready", "quest/a0/epic/one.md").stdout).toBe(
			"! [S] One  quest/a0/epic/one.md\n  Requires:\n    the design review\n",
		);
	});
});

test("check speaks in the quest-log voice", () => {
	expect(Tree.baseline().runOn(COLOUR, "check")).toEqual({
		code: 0,
		stdout: "The quest log is in order: 5 documents checked.\n",
		stderr: "",
	});
});

test("init and uninstall say what changed", () => {
	const root = tempDir();
	const init = runOn(NO_COLOUR, "--root", root, "init").stdout.split("\n");
	expect(init[0]).toBe("Quest is set up for you and your agents. Changed:");
	expect(init).toContain("  quest/README.md");
	expect(init).toContain("  AGENTS.md");
	expect(init.at(-2)).toBe("Next: plan a quest with /quest-plan in Claude Code or $quest-plan in Codex.");
	expect(runOn(NO_COLOUR, "--root", root, "init").stdout).toBe("Quest is already set up; nothing changed.\n");

	const uninstall = runOn(NO_COLOUR, "--root", root, "uninstall").stdout.split("\n");
	expect(uninstall[0]).toBe("Quest has packed up. Changed:");
	expect(uninstall).toContain("  AGENTS.md");
	expect(uninstall.at(-2)).toBe("Your quest log under quest/ stays.");
	expect(runOn(NO_COLOUR, "--root", root, "uninstall").stdout).toBe("Nothing of Quest's left to remove.\n");
});
