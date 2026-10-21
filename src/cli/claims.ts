// Who holds a quest: its claim branch on the remote, or an open PR from a
// branch of that name in any repository. Commands that must not disturb held
// work look here first.
import { execFileSync } from "node:child_process";

import {
	type GitHubDependencies,
	type Repository,
	GitHub,
	githubRepository,
	object,
	remoteUrl,
	string,
} from "./github";

/** A quest's branch: its path without `.md`. */
export function questBranch(path: string): string {
	return path.replace(/\.md$/, "");
}

/** A held quest branch, and the open PR from it if there is one. */
export interface Claim {
	branch: string;
	url: string | null;
}

export interface ClaimDependencies {
	/** Called only when the remote is on GitHub, so other forges need no token. */
	github(): GitHubDependencies;
	warn(message: string): void;
}

/** The `quest/*` branches on `remote`. Plain git, so it works with any forge. */
export function remoteBranches(root: string, remote: string): string[] {
	const out = execFileSync("git", ["-C", root, "ls-remote", remote, "refs/heads/quest/*"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return out
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => line.slice(line.indexOf("\t") + 1).replace(/^refs\/heads\//, ""));
}

/** Every open PR in `repository`, from any head repository, by head branch. */
export async function openPullRequests(
	github: GitHub,
	repository: Repository,
): Promise<{ branch: string; url: string }[]> {
	const rows = await github.all(`${path(repository)}/pulls?state=open&per_page=100`);
	return rows.map((row) => ({ branch: string(object(row.head).ref), url: string(row.html_url) }));
}

/**
 * The repository `repository` was forked from, or `null` if it is not a fork.
 * A fork's clone names the fork `origin`, while its quests are claimed upstream.
 */
export async function forkParent(github: GitHub, repository: Repository): Promise<Repository | null> {
	const parent = object(await (await github.request(path(repository))).json()).parent;
	if (parent === undefined || parent === null) return null;
	const [owner, repo] = string(object(parent).full_name).split("/");
	return { owner, repo };
}

/** The `quest/*` branches in a GitHub `repository`, for one that is not a local remote. */
export async function githubBranches(github: GitHub, repository: Repository): Promise<string[]> {
	const rows = await github.all(`${path(repository)}/git/matching-refs/heads/quest/`);
	return rows.map((row) => string(row.ref).replace(/^refs\/heads\//, ""));
}

function path(repository: Repository): string {
	return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

/**
 * Which of `branches` someone holds: pushed to `remote`, or the head of an
 * open PR there. When `remote` is a GitHub fork, its parent's branches and
 * open PRs count too. Without the remote it warns and checks nothing; off
 * GitHub it checks branches only.
 */
export async function claims(
	root: string,
	remote: string,
	branches: string[],
	deps: ClaimDependencies,
): Promise<Claim[]> {
	let url: string;
	try {
		url = remoteUrl(root, remote);
	} catch {
		deps.warn(`no ${remote} remote, so claims were not checked`);
		return [];
	}
	const wanted = new Set(branches);
	const held = new Map<string, string | null>();
	for (const branch of remoteBranches(root, remote)) if (wanted.has(branch)) held.set(branch, null);
	const repository = githubRepository(url);
	if (repository === null) {
		deps.warn(`${remote} is not on GitHub, so only its branches were checked for claims`);
	} else {
		const github = new GitHub(deps.github());
		const parent = await forkParent(github, repository);
		if (parent !== null) {
			for (const branch of await githubBranches(github, parent)) if (wanted.has(branch)) held.set(branch, null);
		}
		for (const each of parent === null ? [repository] : [repository, parent]) {
			for (const pr of await openPullRequests(github, each)) {
				if (wanted.has(pr.branch)) held.set(pr.branch, pr.url);
			}
		}
	}
	return [...held].map(([branch, url]) => ({ branch, url })).sort((a, b) => (a.branch < b.branch ? -1 : 1));
}
