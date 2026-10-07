// Loading the quest tree from a checkout on disk for the core to read.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { type Doc, comparePaths, isQuest, parse } from "../core";

/** Every quest document under `<root>/quest`, sorted, repository-relative. */
export function collect(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		// Dirent types do not follow symlinks, so a symlinked AGENTS.md is a file
		// here and a directory symlink can never make this recurse forever.
		for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(path);
			} else if (isQuest(path)) {
				out.push(path);
			}
		}
	};
	try {
		walk("quest");
	} catch (error) {
		throw new Error(`scanning ${join(root, "quest")}: ${(error as Error).message}`);
	}
	return out.sort(comparePaths);
}

/** Every quest document, parsed, in tree order. */
export function load(root: string): Doc[] {
	const paths = collect(root);
	if (paths.length === 0) throw new Error(`no quest documents found under ${join(root, "quest")}`);
	return paths.map((path) => parse(path, readFileSync(join(root, path), "utf8")));
}

/** Whether a repository-relative path exists under `root`. */
export function exists(root: string, path: string): boolean {
	return existsSync(join(root, path));
}
