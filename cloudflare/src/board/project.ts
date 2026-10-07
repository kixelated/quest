// What the board reads about one project: its quest tree at a commit, the
// quests history shows finished, and the open changes and issues around it.
//
// Today the only project is this repository, snapshotted at build time by
// scripts/build.ts. Projects stored in Artifacts fill the same shape once
// GitHub sync mirrors them and caches their finished quests.

import snapshot from "../../build/board.json";
import { repo } from "../layout";

/** A quest that a merge deleted: the record history keeps of finished work. */
export type Completed = {
	/** Where the quest lived, following later directory renames. */
	path: string;
	/** Its `# ` title as written, size included. */
	title: string;
	/** The `YYYY-MM-DD` of the commit that finished it. */
	date: string;
	commit: string;
};

/** A repository's quest tree at one commit, with its finished quests. */
export type Snapshot = {
	commit: string;
	date: string;
	documents: { path: string; content: string }[];
	completed: Completed[];
};

/** An open change that names a quest: its branch on a contributor's fork. */
export type Change = { quest: string; author: string; href: string };

/** An issue filed from a fork, quarantined under `issues/` until a maintainer promotes it. */
export type Issue = { path: string; title: string };

export type Project = Snapshot & {
	/** The project's name in URLs: `/repos/<name>`. */
	name: string;
	/** How the project names itself, such as `kixelated/quest`. */
	title: string;
	/** Where the repository's other files can be read, or `null` if nowhere public. */
	web: string | null;
	changes: Change[];
	issues: Issue[];
};

/** The project the site itself is planned in, linked from the nav. */
export const home: Project = {
	...snapshot,
	name: "quest",
	title: "kixelated/quest",
	web: repo,
	// Open changes and issues arrive with the Changes and Fork intake quests.
	changes: [],
	issues: [],
};

export function findProject(name: string): Project | null {
	return name === home.name ? home : null;
}
