import { describe, expect, it } from "vitest";
import { evaluate, removeClaim, isClaimAddition, type Snapshot } from "../src/core";

function fixture(): Snapshot {
	return {
		documents: [
			{
				path: "quest/README.md",
				content: "# Quests\n\n## Goal\n\nRoadmap.\n\n## Required\n\n- [One](/quest/one.md)\n",
			},
			{
				path: "quest/one.md",
				content:
					"# [S] One\n\n## Goal\n\nSee [asset](/assets/image.png), [directory](/assets), and [root](/).\n",
			},
			{ path: "README.md", content: "# Ordinary README\n" },
		],
		paths: ["quest", "quest/README.md", "quest/one.md", "assets", "assets/image.png", "README.md"],
	};
}

// These tests execute the built wasm module in workerd, not a JS validator.
describe("shared wasm core", () => {
	it("validates ordinary file/directory links and reports readiness", () => {
		const snapshot = fixture();
		expect(evaluate(snapshot, "/quest/one.md")).toEqual({
			findings: [],
			ready: ["quest/one.md"],
			blockers: [],
			claims: {},
		});
		snapshot.paths = snapshot.paths.filter((path) => path !== "assets/image.png");
		expect(evaluate(snapshot).findings[0].message).toBe("link does not resolve: /assets/image.png");
	});
	it("uses structured claim parsing and byte-preserving release", () => {
		const snapshot = fixture();
		const original = snapshot.documents[1].content;
		const claim =
			"## Claim\r\n\r\n- Jane (team) Doe (gitlab:jdoe) on branch since 2024-02-29 note=active since last week\r\n\r\n";
		snapshot.documents[1].content += claim + "## Plan\n\nKeep this.\n";
		const result = evaluate(snapshot, "quest/one.md");
		expect(result.findings).toEqual([]);
		expect(result.ready).toEqual([]);
		expect(result.claims["quest/one.md"]).toMatchObject({
			name: "Jane (team) Doe",
			provider: "gitlab",
			identity: "jdoe",
			location: "branch",
			date: "2024-02-29",
		});
		expect(result.blockers?.[0].text).toContain("claimed by Jane");
		expect(removeClaim(snapshot.documents[1].content)).toBe(original + "## Plan\n\nKeep this.\n");
	});
	it("accepts only a Claim addition and its minimal separator", () => {
		const claim = "## Claim\n\n- Jane (github:j) on fork since 2026-10-02\n";
		for (const newline of ["\n", "\r\n"]) {
			const before = "# [S] One" + newline;
			expect(isClaimAddition(before, before + newline + claim)).toBe(true);
			expect(isClaimAddition(before, before + newline + newline + claim)).toBe(false);
			expect(isClaimAddition(before, before + "unrelated" + newline + claim)).toBe(false);
		}
		expect(isClaimAddition("unchanged", "unchanged\n\n" + claim)).toBe(true);
		expect(isClaimAddition(claim, claim)).toBe(false);
		expect(isClaimAddition("before\n\n", "before\n\n\n" + claim)).toBe(false);
	});
	it("rejects malformed inputs and malformed claim edits", () => {
		expect(() => evaluate({ documents: [], paths: [] })).toThrow("no quest documents");
		const snapshot = fixture();
		snapshot.documents.push(snapshot.documents[0]);
		expect(() => evaluate(snapshot)).toThrow("duplicate document");
		expect(() => removeClaim("## Claim\n\n- incomplete\n")).toThrow("invalid Claim");
		expect(removeClaim("```markdown\n## Claim\n\n- fake\n```\n")).toBe("```markdown\n## Claim\n\n- fake\n```\n");
	});
});
