// Loading the quest tree from a checkout on disk for the core to read.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { type Doc, comparePaths, isQuest, parse } from "../core";

/**
 * `<root>/<path>` as a user would name it in an error: `./quest`, not the
 * normalized `quest`.
 */
export function under(root: string, path: string): string {
	return `${root.replace(/\/+$/, "")}/${path}`;
}

/** Every quest document under `<root>/quest`, sorted, repository-relative. */
export function collect(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		// Dirent types do not follow symlinks, so a symlinked AGENTS.md is a file
		// here and a directory symlink can never make this recurse forever.
		for (const entry of readdirSync(under(root, dir), { withFileTypes: true })) {
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
		throw new Error(`scanning ${under(root, "quest")}: ${(error as Error).message}`);
	}
	return out.sort(comparePaths);
}

/** Every quest document, parsed, in tree order. */
export function load(root: string): Doc[] {
	const paths = collect(root);
	if (paths.length === 0) throw new Error(`no quest documents found under ${under(root, "quest")}`);
	return paths.map((path) => parse(path, read(root, path)));
}

/** Whether a repository-relative path exists under `root`. */
export function exists(root: string, path: string): boolean {
	return existsSync(join(root, path));
}

// Fatal, so a file that is not UTF-8 is an error rather than silently mangled
// text; ignoreBOM keeps a byte-order mark in the text, as the parser expects.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function read(root: string, path: string): string {
	try {
		return UTF8.decode(readFileSync(join(root, path)));
	} catch (error) {
		throw new Error(`reading ${path}: ${(error as Error).message}`);
	}
}
