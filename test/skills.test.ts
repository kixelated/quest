// The bundled skills and the stubs this repository installs.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { SKILLS } from "../src/cli/skills";

/**
 * The stub writes the installed name, so a `name:` in the source would install
 * under one name and trigger as another.
 */
test.each(SKILLS.map((skill) => [skill.name, skill] as const))("%s frontmatter is complete", (_, skill) => {
	expect(skill.frontmatter.split("\n").some((line) => line.startsWith("name:"))).toBe(false);
	expect(skill.description).not.toBe("");
	// The stub copies the description as a plain YAML scalar, where ": " is invalid.
	expect(skill.description).not.toContain(": ");
	expect(skill.body.trim()).not.toBe("");
});

test("skills are sorted and unique", () => {
	const names = SKILLS.map((skill) => skill.name);
	expect(names).toEqual([...new Set(names)].sort());
});

/**
 * The contract is no longer a file an adopter has, so a skill pointing at one
 * sends the agent looking for nothing.
 */
test.each(SKILLS.map((skill) => [skill.name, skill] as const))("%s points at the guide", (_, skill) => {
	expect(skill.body).not.toContain("AGENTS.md");
});

/**
 * This repository installs the same stubs as everyone else, so a skill added or
 * renamed here without its stub fails rather than going unused.
 */
test("the repository's stubs are current", () => {
	const dir = join(import.meta.dirname, "../.claude/skills");
	expect(readdirSync(dir).sort()).toEqual(SKILLS.map((skill) => skill.installed));
	for (const skill of SKILLS) {
		expect(
			readFileSync(join(dir, skill.installed, "SKILL.md"), "utf8"),
			`${skill.name} stub is stale; regenerate it with \`quest skill ${skill.name} --stub\``,
		).toBe(skill.stub);
	}
});
