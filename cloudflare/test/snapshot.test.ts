import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../src/core";
import { readSnapshot, readTreeSnapshot, SnapshotError } from "../src/snapshot";

const sha = "a".repeat(40);
function fixture() {
	const entry = (name: string, type: ArtifactsTreeEntryType, hash: string): ArtifactsTreeEntry => ({
		name,
		type,
		hash,
		mode: { tree: "40000", blob: "100644", exec: "100755", symlink: "120000", gitlink: "160000" }[type],
	});
	const trees: Record<string, ArtifactsTreeEntry[]> = {
		root: [
			entry("quest", "tree", "quest"),
			entry("assets", "tree", "assets"),
			entry("alias", "symlink", "alias"),
			entry("README.md", "exec", "readme"),
			entry("issues", "tree", "issues"),
		],
		quest: [entry("README.md", "blob", "rootdoc"), entry("one.md", "blob", "one")],
		assets: [entry("image.png", "blob", "binary")],
		issues: [entry("one.md", "blob", "issue")],
	};
	const blobs: Record<string, Blob> = {
		rootdoc: new Blob(["# Quests\n\n## Goal\n\nRoadmap.\n\n## Required\n\n- [One](/quest/one.md)\n"]),
		one: new Blob(["# [S] One\n\n## Goal\n\nSee [asset](/alias/image.png) and [directory](/assets).\n"]),
		readme: new Blob(["# Ordinary README\n"]),
		issue: new Blob(["\uFEFF# Untrusted issue\r\n"]),
		alias: new Blob(["assets"]),
	};
	const repo = {
		readCommit: vi.fn(async (_sha: string) => ({
			hash: sha,
			treeHash: "root",
			message: "fixture",
			author: { name: "A", email: "a@b" },
			committer: { name: "A", email: "a@b" },
			parents: [],
			authoredAt: 0,
			committedAt: 0,
		})),
		readTree: vi.fn(async (hash: string) => trees[hash] ?? null),
		readBlob: vi.fn(async (hash: string) => blobs[hash] ?? null),
	};
	return { repo, trees, blobs };
}
describe("immutable Artifacts snapshots", () => {
	it("includes complete modes, ordinary links, symlink aliases, and byte-exact Markdown", async () => {
		const { repo } = fixture();
		const snapshot = await readSnapshot(repo, sha);
		expect(repo.readCommit).toHaveBeenCalledExactlyOnceWith(sha);
		expect(snapshot.commitSha).toBe(sha);
		expect(snapshot.paths).toContain("alias/image.png");
		expect(snapshot.entries.find((entry) => entry.path === "README.md")?.mode).toBe("100755");
		expect(snapshot.documents.find((doc) => doc.path === "issues/one.md")?.content).toBe(
			"\uFEFF# Untrusted issue\r\n",
		);
		expect(repo.readBlob).not.toHaveBeenCalledWith("binary");
		expect(evaluate(snapshot)).toMatchObject({ findings: [], ready: ["quest/one.md"] });
	});
	it("reads candidate trees without a commit lookup", async () => {
		const { repo } = fixture();
		const snapshot = await readTreeSnapshot(repo, "root");
		expect(repo.readCommit).not.toHaveBeenCalled();
		expect(evaluate(snapshot)).toMatchObject({ findings: [], ready: ["quest/one.md"] });
	});
	it("rejects incomplete objects, invalid UTF-8 and unsafe names", async () => {
		const missing = fixture();
		delete missing.blobs.one;
		await expect(readSnapshot(missing.repo, sha)).rejects.toBeInstanceOf(SnapshotError);
		const invalid = fixture();
		invalid.blobs.one = new Blob([new Uint8Array([0xff])]);
		await expect(readSnapshot(invalid.repo, sha)).rejects.toThrow("UTF-8");
		const name = fixture();
		name.trees.root[0].name = "../quest";
		await expect(readSnapshot(name.repo, sha)).rejects.toThrow("entry name");
		await expect(readSnapshot(fixture().repo, "main")).rejects.toThrow("immutable");
	});
	it("bounds inventory and all Markdown/symlink reads", async () => {
		await expect(readSnapshot(fixture().repo, sha, { maxEntries: 2 })).rejects.toThrow("entry limit");
		await expect(readSnapshot(fixture().repo, sha, { maxBlobBytes: 8 })).rejects.toThrow("byte limit");
		await expect(readSnapshot(fixture().repo, sha, { maxTotalBytes: 120 })).rejects.toThrow("byte limit");
		await expect(readSnapshot(fixture().repo, sha, { maxEntries: NaN })).rejects.toThrow("Invalid snapshot limit");
	});
	it("keeps binding failures distinguishable from invalid snapshots", async () => {
		const { repo } = fixture();
		const serviceFailure = new Error("Artifacts service unavailable");
		repo.readTree.mockRejectedValueOnce(serviceFailure);
		await expect(readSnapshot(repo, sha)).rejects.toBe(serviceFailure);
	});
	it("rejects broken Markdown symlinks and ignores broken ordinary links", async () => {
		const { repo, trees, blobs } = fixture();
		blobs.alias = new Blob(["missing"]);
		const snapshot = await readSnapshot(repo, sha);
		expect(evaluate(snapshot).findings[0].message).toContain("/alias/image.png");
		trees.quest.push({ name: "broken.md", mode: "120000", type: "symlink", hash: "broken" });
		blobs.broken = new Blob(["../missing.md"]);
		await expect(readSnapshot(repo, sha)).rejects.toThrow("does not resolve");
	});
});
