// `quest init` and `quest uninstall` in temporary repositories.

import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { REFERENCE_LINE, init, uninstall } from "../src/cli/setup";
import { tempDir } from "./fixture";

const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");
const isFile = (dir: string, path: string) => existsSync(join(dir, path)) && lstatSync(join(dir, path)).isFile();
const isSymlink = (dir: string, path: string) => {
	try {
		return lstatSync(join(dir, path)).isSymbolicLink();
	} catch {
		return false;
	}
};

test("init creates the layout and is idempotent", () => {
	const dir = tempDir();
	expect(init(dir)).not.toEqual([]);
	expect(isFile(dir, ".claude/skills/quest-start/SKILL.md")).toBe(true);
	expect(existsSync(join(dir, ".agents/skills/quest-start/SKILL.md"))).toBe(true);
	expect(isFile(dir, "quest/README.md")).toBe(true);
	expect(existsSync(join(dir, ".gitignore"))).toBe(false);
	expect(read(dir, "AGENTS.md")).toContain(REFERENCE_LINE);
	expect(init(dir)).toEqual([]);
});

test("init refuses a skill that is not a stub", () => {
	const dir = tempDir();
	mkdirSync(join(dir, ".claude/skills/quest-start"), { recursive: true });
	writeFileSync(join(dir, ".claude/skills/quest-start/SKILL.md"), "# My workflow\n");
	expect(() => init(dir)).toThrow("not a Quest stub");
});

test("init appends to AGENTS.md, not CLAUDE.md, when both exist", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "AGENTS.md"), "# Repo\n\nKeep this.\n");
	writeFileSync(join(dir, "CLAUDE.md"), "# Claude only\n");
	init(dir);
	expect(read(dir, "AGENTS.md")).toContain("Keep this.");
	expect(read(dir, "AGENTS.md")).toContain(REFERENCE_LINE);
	expect(read(dir, "CLAUDE.md")).not.toContain(REFERENCE_LINE);
});

test("init uses CLAUDE.md when only it exists", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "CLAUDE.md"), "# Claude\n");
	init(dir);
	expect(read(dir, "CLAUDE.md")).toContain(REFERENCE_LINE);
	expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
});

test("an uninstall round trip preserves user content", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "AGENTS.md"), "# Repo\n\nUser rule.\n");
	mkdirSync(join(dir, "quest/a0"), { recursive: true });
	writeFileSync(join(dir, "quest/a0/plan.md"), "# [S] Keep\n\n## Goal\n\nStay.\n");
	init(dir);
	uninstall(dir);
	expect(read(dir, "AGENTS.md")).toBe("# Repo\n\nUser rule.\n");
	expect(isFile(dir, "quest/a0/plan.md")).toBe(true);
	expect(existsSync(join(dir, ".claude"))).toBe(false);
	expect(existsSync(join(dir, ".agents"))).toBe(false);
});

test("a round trip with the Codex skills directory", () => {
	const dir = tempDir();
	mkdirSync(join(dir, ".agents/skills"), { recursive: true });
	init(dir);
	expect(isFile(dir, ".agents/skills/quest-start/SKILL.md")).toBe(true);
	expect(existsSync(join(dir, ".claude/skills/quest-start/SKILL.md"))).toBe(true);
	expect(isSymlink(dir, ".claude/skills")).toBe(true);

	uninstall(dir);
	expect(existsSync(join(dir, ".agents/skills"))).toBe(false);
	expect(isSymlink(dir, ".claude/skills")).toBe(false);
});

test("init refuses two skill directories", () => {
	const dir = tempDir();
	mkdirSync(join(dir, ".claude/skills"), { recursive: true });
	mkdirSync(join(dir, ".agents/skills"), { recursive: true });
	expect(() => init(dir)).toThrow("both");
});

test("uninstall is idempotent", () => {
	const dir = tempDir();
	init(dir);
	uninstall(dir);
	expect(uninstall(dir)).toEqual([]);
});

test("init keeps a reworded reference line", () => {
	const dir = tempDir();
	const custom = "Quests: run `quest guide` first; skills live upstream.";
	writeFileSync(join(dir, "AGENTS.md"), `# Repo\n\n${custom}\n`);
	init(dir);
	expect(read(dir, "AGENTS.md")).toBe(`# Repo\n\n${custom}\n`);

	uninstall(dir);
	expect(read(dir, "AGENTS.md")).toBe("# Repo\n");
});
