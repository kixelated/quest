import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { quarantineFiles, warningHook, warning } from "../src/intake/quarantine";

describe("generated issue quarantine", () => {
	it("preserves existing instructions and hook settings, detects script collision", () => {
		const files = quarantineFiles({
			"AGENTS.md": "# Existing\n",
			"issues/AGENTS.md": "Keep this policy.\n",
			".claude/settings.json": JSON.stringify({
				permissions: { deny: ["Read(.env)"] },
				hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "existing" }] }] },
			}),
		});
		expect(files.find((file) => file.path === "AGENTS.md")?.content).toContain("# Existing\n");
		expect(files.find((file) => file.path === "issues/AGENTS.md")?.content).toContain("Keep this policy.\n");
		const settings = JSON.parse(files.find((file) => file.path === ".claude/settings.json")!.content!);
		expect(settings.permissions).toEqual({ deny: ["Read(.env)"] });
		expect(settings.hooks.PreToolUse).toHaveLength(2);
		expect(quarantineFiles(Object.fromEntries(files.map((file) => [file.path, file.content])))).toEqual(files);
		expect(() => quarantineFiles({ ".quest/warn-issues.mjs": "unrelated" })).toThrow("reconciliation");
	});
	it("runs the actual hook for reads/search/shell paths, ignores unrelated edits and commands", () => {
		const root = mkdtempSync(join(tmpdir(), "quest-hooks-"));
		try {
			mkdirSync(join(root, ".quest"));
			mkdirSync(join(root, "issues"));
			const script = join(root, ".quest/warn-issues.mjs");
			writeFileSync(script, warningHook);
			for (const [event, expected] of [
				[{ tool_name: "Read", tool_input: { file_path: "issues/problem.md" } }, true],
				[{ tool_name: "Grep", tool_input: { path: "issues", pattern: "foo" } }, true],
				[{ tool_name: "Glob", tool_input: { pattern: "issues/**/*.md" } }, true],
				[{ tool_name: "Bash", tool_input: { command: "cat issues/problem.md" } }, true],
				[{ tool_name: "exec_command", tool_input: { cmd: "rg x issues/" } }, true],
				[{ tool_name: "Read", cwd: join(root, "issues"), tool_input: { file_path: "problem.md" } }, true],
				[{ tool_name: "Edit", tool_input: { file_path: "src/index.ts" } }, false],
				[{ tool_name: "Bash", tool_input: { command: "just test" } }, false],
				[{ tool_name: "Read", tool_input: { file_path: "README.md" } }, false],
			] as const) {
				const result = spawnSync(process.execPath, [script], {
					cwd: root,
					input: JSON.stringify({ cwd: root, ...event }),
					encoding: "utf8",
				});
				expect(result.status, result.stderr).toBe(0);
				if (expected) {
					expect(result.stdout, JSON.stringify(event)).not.toBe("");
					expect(JSON.parse(result.stdout)).toEqual({
						hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: warning },
					});
				} else expect(result.stdout).toBe("");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
