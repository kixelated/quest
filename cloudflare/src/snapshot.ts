import type { Snapshot } from "./core";

export class SnapshotError extends Error {
	override name = "SnapshotError";
}

export interface SnapshotEntry extends ArtifactsTreeEntry {
	path: string;
}
export interface TreeSnapshot extends Snapshot {
	entries: SnapshotEntry[];
}
export interface RepositorySnapshot extends TreeSnapshot {
	commitSha: string;
}
export interface SnapshotLimits {
	maxEntries: number;
	maxBlobBytes: number;
	maxTotalBytes: number;
}

const defaults: SnapshotLimits = { maxEntries: 10_000, maxBlobBytes: 1_048_576, maxTotalBytes: 16_777_216 };
type Reader = Pick<ArtifactsRepo, "readCommit" | "readTree" | "readBlob">;

// Fetch one immutable commit, including ordinary file/directory paths used by
// Markdown links. Missing objects and undecodable Markdown fail the operation.
// Callers authorize the repository and choose limits before calling this.
export async function readSnapshot(
	repo: Reader,
	commitSha: string,
	overrides: Partial<SnapshotLimits> = {},
): Promise<RepositorySnapshot> {
	if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new SnapshotError("Expected an immutable commit SHA");
	const commit = await repo.readCommit(commitSha);
	if (!commit || commit.hash !== commitSha) throw new SnapshotError("Commit not found");
	return { commitSha, ...(await readTreeSnapshot(repo, commit.treeHash, overrides)) };
}

// Candidate merge trees use the same reader without creating a temporary commit.
export async function readTreeSnapshot(
	repo: Pick<ArtifactsRepo, "readTree" | "readBlob">,
	treeHash: string,
	overrides: Partial<SnapshotLimits> = {},
): Promise<TreeSnapshot> {
	const limits = { ...defaults, ...overrides };
	for (const value of Object.values(limits)) {
		if (!Number.isSafeInteger(value) || value < 1) throw new SnapshotError("Invalid snapshot limit");
	}
	const entries: SnapshotEntry[] = [];
	const byPath = new Map<string, SnapshotEntry>();
	async function walk(hash: string, prefix: string): Promise<void> {
		const tree = await repo.readTree(hash);
		if (!tree) throw new SnapshotError("Tree not found");
		for (const entry of tree) {
			if (
				!entry.name ||
				entry.name === "." ||
				entry.name === ".." ||
				entry.name.includes("/") ||
				entry.name.includes("\0")
			) {
				throw new SnapshotError("Invalid tree entry name");
			}
			const path = prefix + entry.name;
			if (byPath.has(path)) throw new SnapshotError("Duplicate tree entry");
			if (entries.length >= limits.maxEntries) throw new SnapshotError("Snapshot entry limit exceeded");
			const full = { ...entry, path };
			entries.push(full);
			byPath.set(path, full);
			if (entry.type === "tree") await walk(entry.hash, `${path}/`);
		}
	}
	await walk(treeHash, "");
	byPath.set("", { path: "", name: "", type: "tree", mode: "40000", hash: treeHash });
	let totalBytes = 0;
	const bodies = new Map<string, string>();
	async function text(entry: SnapshotEntry): Promise<string> {
		const blob = await repo.readBlob(entry.hash);
		if (!blob) throw new SnapshotError("Blob not found");
		totalBytes += blob.size;
		if (blob.size > limits.maxBlobBytes || totalBytes > limits.maxTotalBytes)
			throw new SnapshotError("Snapshot byte limit exceeded");
		// Decode fatally, like Rust's read_to_string; replacement characters
		// would otherwise change validation and a claim's byte-preserving edit.
		const bytes = await blob.arrayBuffer();
		try {
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch {
			throw new SnapshotError("Blob is not valid UTF-8");
		}
	}
	for (const entry of entries) {
		if (entry.type === "symlink") bodies.set(entry.path, await text(entry));
	}
	function normalized(path: string): string | null {
		if (path.startsWith("/")) return null;
		const parts: string[] = [];
		for (const part of path.split("/")) {
			if (part === "..") {
				if (!parts.pop()) return null;
			} else if (part && part !== ".") parts.push(part);
		}
		return parts.join("/");
	}
	function resolve(path: string, seen = new Set<string>()): SnapshotEntry | null {
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const prefix = parts.slice(0, i).join("/");
			const entry = byPath.get(prefix);
			if (!entry) return null;
			if (entry.type === "symlink") {
				if (seen.has(prefix)) return null;
				seen.add(prefix);
				const link = bodies.get(prefix)!;
				if (!link || link.startsWith("/")) return null;
				const target = normalized([...parts.slice(0, i - 1), link, ...parts.slice(i)].join("/"));
				return target === null ? null : resolve(target, seen);
			}
			if (i < parts.length && entry.type !== "tree") return null;
		}
		return byPath.get(path) ?? null;
	}
	const paths = new Set<string>();
	const documents: Snapshot["documents"] = [];
	for (const entry of entries) {
		const resolved = resolve(entry.path);
		if (resolved) paths.add(entry.path);
		if (entry.type === "symlink" && resolved?.type === "tree") {
			// Native link existence follows directory symlinks, but collection
			// does not recurse into them; expose aliases only as inventory paths.
			for (const child of entries) {
				const base = resolved.path ? `${resolved.path}/` : "";
				if (!child.path.startsWith(base)) continue;
				const alias = `${entry.path}/${child.path.slice(base.length)}`;
				if (resolve(alias)) paths.add(alias);
				if (paths.size > limits.maxEntries) throw new SnapshotError("Snapshot entry limit exceeded");
			}
		}
		if (!entry.path.endsWith(".md") || entry.type === "tree" || entry.type === "gitlink") continue;
		if (!resolved || (resolved.type !== "blob" && resolved.type !== "exec"))
			throw new SnapshotError("Markdown path does not resolve to a file");
		documents.push({ path: entry.path, content: await text(resolved) });
	}
	if (paths.size > limits.maxEntries) throw new SnapshotError("Snapshot entry limit exceeded");
	return { entries, paths: [...paths].sort(), documents };
}
