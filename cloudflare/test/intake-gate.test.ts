import { describe, expect, it } from "vitest";
import { gate, maxMarkdownBytes } from "../src/intake/gate";
import { claimDisplayName, claimMarkdownName } from "../src/intake/claim";
import { evaluate } from "../src/core";
import type { Fork } from "../src/intake/registry";
import type { RepositorySnapshot } from "../src/snapshot";

export const original = "# [S] One\n\n## Goal\n\nShip one.\n";
export const rootDoc = "# Quests\n\n## Goal\n\nWork.\n\n## Required\n\n- [One](/quest/one.md)\n";
export const fork: Fork = {
	userId: "contributor",
	provider: "github",
	identity: "1234",
	name: "Contributor (team)",
	email: "contributor@example.com",
	forkName: "fork-one",
	repositoryName: "upstream",
	remote: "https://artifacts.example/fork-one.git",
	lastPushAt: Date.now(),
	subscriptionId: "subscription",
};
export function claimed(owner = fork): string {
	return (
		original +
		`\n## Claim\n\n- ${owner.name} (${owner.provider}:${owner.identity}) on ${owner.remote} since 2026-10-02\n`
	);
}
export function fixture(files: Record<string, string>, modes: Record<string, string> = {}): RepositorySnapshot {
	const docs = { "quest/README.md": rootDoc, "quest/one.md": original, ...files };
	const paths = new Set<string>();
	const entries = Object.entries(docs).map(([path, content]) => {
		const parts = path.split("/");
		for (let n = 1; n <= parts.length; n++) paths.add(parts.slice(0, n).join("/"));
		const mode = modes[path] ?? "100644";
		return {
			path,
			name: parts.at(-1)!,
			mode,
			hash: content,
			type: ({ "100644": "blob", "100755": "exec", "120000": "symlink", "160000": "gitlink" } as const)[
				mode as "100644"
			],
		};
	});
	return {
		commitSha: "a".repeat(40),
		documents: Object.entries(docs).map(([path, content]) => ({ path, content })),
		paths: [...paths],
		entries,
	};
}

describe("deterministic fork promotion gate", () => {
	it("accepts the authenticated Claim with one normal blank separator", () => {
		const before = fixture({}),
			after = fixture({ "quest/one.md": claimed() });
		expect(evaluate(before).ready).toContain("quest/one.md");
		expect(gate(before, after, before, fork)).toEqual({
			kind: "claim",
			file: { path: "quest/one.md", content: claimed() },
		});
	});
	it.each(["Alice *Doe*", "Alice (team) on GitHub", "Zoë 李", "Alice   Doe", "A <team> [link] \\ `code`"])(
		"round-trips canonical claim labels for profile name %s",
		(name) => {
			const owner = { ...fork, name: claimDisplayName(name) };
			const content =
				original +
				`\n## Claim\n\n- ${claimMarkdownName(owner.name)} (${owner.provider}:${owner.identity}) on ${owner.remote} since 2026-10-02\n`;
			const after = fixture({ "quest/one.md": content });
			expect(evaluate(after).claims["quest/one.md"].name).toBe(owner.name);
			expect(gate(fixture({}), after, fixture({}), owner)?.kind).toBe("claim");
		},
	);

	it.each(["name", "provider", "identity", "remote"] as const)("rejects a forged claimant %s", (field) => {
		const forged = { ...fork, [field]: "forged" };
		expect(gate(fixture({}), fixture({ "quest/one.md": claimed(forged) }), fixture({}), fork)).toBeNull();
	});
	it("rejects changes outside Claim, stale quest content, existing claims, and invalid dates", () => {
		const before = fixture({});
		for (const content of [
			claimed().replace("Ship one.", "Changed plan."),
			claimed().replace("2026-10-02", "2026-02-30"),
			claimed() + "\n## Plan\n\nExecute this.\n",
			claimed().replace("\n## Claim", "\n\n## Claim"),
		]) {
			expect(gate(before, fixture({ "quest/one.md": content }), before, fork)).toBeNull();
		}
		expect(
			gate(
				before,
				fixture({ "quest/one.md": claimed() }),
				fixture({ "quest/one.md": original + "Updated.\n" }),
				fork,
			),
		).toBeNull();
		expect(
			gate(before, fixture({ "quest/one.md": claimed() }), fixture({ "quest/one.md": claimed() }), fork),
		).toBeNull();
	});
	it("requires upstream readiness and full candidate validation", () => {
		const blocked = fixture({
			"quest/one.md": original + "\n## Required\n\n- [Other](/quest/other.md)\n",
			"quest/other.md": "# [S] Other\n\n## Goal\n\nOther.\n",
		});
		const after = fixture({
			"quest/one.md":
				blocked.documents.find((d) => d.path === "quest/one.md")!.content + claimed().slice(original.length),
			"quest/other.md": "# [S] Other\n\n## Goal\n\nOther.\n",
		});
		expect(gate(blocked, after, blocked, fork)).toBeNull();
		const malformed = fixture({ "quest/one.md": "# Missing goal\n" });
		expect(gate(fixture({}), fixture({ "issues/new.md": "# Issue\n" }), malformed, fork)).toBeNull();
	});
	it("accepts only one new bounded regular Markdown issue", () => {
		const before = fixture({}),
			content = "# Problem\n\nUntrusted data.\n";
		expect(gate(before, fixture({ "issues/new-issue.md": content }), before, fork)?.kind).toBe("issue");
		for (const files of [
			{ "issues/new.md": content, "evil.sh": "echo run" },
			{ "issues/../escape.md": content },
			{ "issues/AGENTS.md": content },
			{ "issues/oversized.md": "x".repeat(maxMarkdownBytes + 1) },
			{ "issues/binary.md": "a\0b" },
			{ "issues/bom.md": "\uFEFF# Issue\n" },
		] as Record<string, string>[])
			expect(gate(before, fixture(files), before, fork)).toBeNull();
		for (const mode of ["100755", "120000", "160000"])
			expect(
				gate(before, fixture({ "issues/new.md": content }, { "issues/new.md": mode }), before, fork),
			).toBeNull();
		expect(
			gate(before, fixture({ "issues/new.md": content }), fixture({ "issues/new.md": "Already present" }), fork),
		).toBeNull();
		const old = fixture({ "issues/new.md": content });
		expect(gate(old, fixture({ "issues/new.md": "edited" }), old, fork)).toBeNull();
	});
});
