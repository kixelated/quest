// A minimal but complete quest tree on disk: root epic -> act ->
// epic -> two quests, one blocking the other.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, expect } from "vitest";

import { blockers, check, formatFinding, ready, renderBlocker } from "../src/core";
import { type Output, main } from "../src/cli/main";
import { exists, load } from "../src/cli/tree";

export const ROOT_README = `# Quests

## Goal

The permanent root epic.

## Required

- [A0](/quest/a0/README.md)
`;

export const A0_README = `# A0

## Goal

An act.

## Required

- [Epic](/quest/a0/epic/README.md)
`;

export const EPIC_README = `# Epic

## Goal

An epic.

## Required

- [One](/quest/a0/epic/one.md)
- [Two](/quest/a0/epic/two.md)
`;

export const ONE = `# [S] One

## Goal

A quest.
`;

export const TWO = `# [S] Two

## Goal

Another quest.

## Required

- [One](/quest/a0/epic/one.md) - must finish first
`;

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temporary directory, removed after the test. */
export function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "quest-test-"));
	dirs.push(dir);
	return dir;
}

export class Tree {
	readonly path = tempDir();

	/** The baseline tree, which passes. */
	static baseline(): Tree {
		return new Tree()
			.write("quest/README.md", ROOT_README)
			.write("quest/a0/README.md", A0_README)
			.write("quest/a0/epic/README.md", EPIC_README)
			.write("quest/a0/epic/one.md", ONE)
			.write("quest/a0/epic/two.md", TWO);
	}

	write(rel: string, body: string): this {
		const path = join(this.path, rel);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body);
		return this;
	}

	append(rel: string, body: string): this {
		return this.write(rel, readFileSync(join(this.path, rel), "utf8") + body);
	}

	remove(rel: string): this {
		rmSync(join(this.path, rel), { recursive: true });
		return this;
	}

	read(rel: string): string {
		return readFileSync(join(this.path, rel), "utf8");
	}

	findings(): string[] {
		return check(load(this.path), (path) => exists(this.path, path)).map(formatFinding);
	}

	/** The rendered blocker chain: one line per blocker, nesting indented. */
	blockers(path: string): string[] {
		const found = blockers(load(this.path), path);
		if (found === null) throw new Error(`${path} is not a quest`);
		return found.flatMap((blocker) => renderBlocker(blocker));
	}

	ready(): string[] {
		return ready(load(this.path));
	}

	/** Run the CLI against this tree. */
	run(...args: string[]): { code: number; stdout: string; stderr: string } {
		return run("--root", this.path, ...args);
	}

	accepts() {
		expect(this.findings()).toEqual([]);
	}

	rejects(expected: string) {
		const findings = this.findings();
		expect(
			findings.some((f) => f.includes(expected)),
			`expected a finding containing ${JSON.stringify(expected)}, got: ${JSON.stringify(findings, null, 2)}`,
		).toBe(true);
	}

	without(unexpected: string) {
		const findings = this.findings();
		expect(
			findings.some((f) => f.includes(unexpected)),
			`expected NO finding containing ${JSON.stringify(unexpected)}, got: ${JSON.stringify(findings, null, 2)}`,
		).toBe(false);
	}
}

/** Run the CLI in-process, capturing its output. */
export function run(...args: string[]): { code: number; stdout: string; stderr: string } {
	let stdout = "";
	let stderr = "";
	const out: Output = {
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
	};
	const code = main(args, out);
	return { code, stdout, stderr };
}
