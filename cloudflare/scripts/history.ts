// Finished quests, read from Git history. Merged quests are deleted, so
// history is the only record of them. Pure, so the Worker tests can run it.

import type { Completed } from "../src/board/project";

/** The `git log` this reads: newest first, with renames, one NUL before each commit. */
export const LOG = ["log", "-M", "--name-status", "--format=%x00%H %cs"];

/** Quest documents, as the CLI collects them: Markdown other than agent instructions. */
export function isQuest(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return path.startsWith("quest/") && name.endsWith(".md") && name !== "AGENTS.md" && name !== "CLAUDE.md";
}

function dirname(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

/**
 * The quests that `log` (from `LOG`) shows finished. A deletion counts when
 * its commit also changed something outside `quest/`: deleting only plans
 * abandons a quest rather than finishing it. Paths follow later directory
 * renames, such as an act's, to where they live now; `dirs` is every
 * directory that exists now. `read` returns a file's text at a commit.
 */
export function finished(log: string, dirs: Set<string>, read: (commit: string, path: string) => string): Completed[] {
	const moved = new Map<string, string>();
	// A directory can move back to a name it left, so each one moves at most once.
	const current = (path: string, seen = new Set<string>()): string => {
		for (let dir = dirname(path); dir !== ""; dir = dirname(dir)) {
			const to = moved.get(dir);
			if (to === undefined || seen.has(dir)) continue;
			seen.add(dir);
			return current(to + path.slice(dir.length), seen);
		}
		return path;
	};
	const found: Completed[] = [];
	// Newest first, so every rename is known before the older deletions it moves.
	for (const block of log.split("\0").slice(1)) {
		const [header, ...lines] = block.trim().split("\n");
		const [commit, date] = header.split(" ");
		const changes = lines.filter(Boolean).map((line) => line.split("\t"));
		const work = changes.some(([, ...paths]) => paths.some((path) => !path.startsWith("quest/")));
		// Only a directory that no longer exists has moved; a quest that moved
		// between two live epics says nothing about the rest of either. Renames
		// come first, so a quest finished in the same commit follows them too.
		for (const [status, from, to] of changes) {
			if (!status.startsWith("R")) continue;
			const [old, now] = [dirname(from), dirname(to)];
			if (old !== now && !dirs.has(old) && !moved.has(old)) moved.set(old, now);
		}
		for (const [status, from] of changes) {
			if (status !== "D" || !work || !isQuest(from)) continue;
			const title = /^# (.+)$/m.exec(read(`${commit}^`, from))?.[1] ?? from;
			found.push({ path: current(from), title, date, commit });
		}
	}
	return found;
}
