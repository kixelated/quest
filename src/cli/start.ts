// `quest start`: claim a ready quest by pushing an empty claim commit to its
// branch and opening a draft PR from it right away, and release that claim
// while nothing but the claim commit is on the branch.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
	type ClaimDependencies,
	type OpenPull,
	type Upstream,
	gitOutput,
	held,
	openPullRequests,
	pullsFrom,
	questBranch,
	repositoryPath,
	upstream,
} from "./claims";
import { object, string } from "./github";

/** Someone else holds the quest, or the claim cannot be released; distinct from a failure. */
export class Refusal extends Error {}

export interface Started {
	branch: string;
	/** The claim commit, also the local branch's tip when that branch was free. */
	sha: string;
	/** The draft PR; `null` off GitHub. */
	url: string | null;
}

/** Claim `path`, a ready quest, on `remote`. Throws `Refusal` when someone else holds it. */
export async function startQuest(
	root: string,
	path: string,
	title: string,
	remote: string,
	deps: ClaimDependencies,
): Promise<Started> {
	const branch = questBranch(path);
	const up = await upstream(root, remote, deps);
	const [claim] = await held(root, up, [branch]);
	if (claim) throw new Refusal(`${path} is held by ${describe(claim.branch, claim.pull, Date.now())}`);

	// Build the claim on the upstream default branch, which must still have the quest.
	const base = remoteHead(root, up.git);
	const prefix = gitOutput(root, ["rev-parse", "--show-prefix"]);
	if (!succeeds(root, ["cat-file", "-e", `${base}:${prefix}${path}`])) {
		throw new Refusal(`${path} is not on the upstream default branch; update your checkout`);
	}
	// A nonce keeps two claimers on the same base, identity, and second from building the same commit.
	const nonce = randomBytes(8).toString("hex");
	const sha = gitOutput(root, [
		"commit-tree",
		`${base}^{tree}`,
		"-p",
		base,
		"-m",
		`chore(quest): claim ${path}`,
		"-m",
		`Quest-Claim: ${nonce}`,
	]);
	push(root, remote, [`${sha}:refs/heads/${branch}`], `someone pushed ${branch} first`);

	let url: string | null = null;
	if (up.github === null) {
		deps.warn(`${remote} is not on GitHub, so the claim branch was pushed without a PR`);
	} else {
		url = await openDraft(root, up, remote, path, title, branch, sha);
	}

	// A local branch to build on, unless one already exists.
	if (!succeeds(root, ["update-ref", `refs/heads/${branch}`, sha, ""])) {
		deps.warn(`local branch ${branch} already exists; the claim commit is ${sha}`);
	}
	return { branch, sha, url };
}

/** Open the draft PR, then keep it only if it is the earliest open PR on the branch. */
async function openDraft(
	root: string,
	up: Upstream,
	remote: string,
	path: string,
	title: string,
	branch: string,
	sha: string,
): Promise<string> {
	const github = up.github!;
	const { owner, repo } = github.repository;
	const fork = github.head.owner !== owner || github.head.repo !== repo;
	let created: OpenPull;
	try {
		const response = await github.client.request(`${repositoryPath(github.repository)}/pulls`, {
			body: {
				title: title.replace(/^\[(XS|S|M|L|XL)\] /, ""),
				head: fork ? `${github.head.owner}:${branch}` : branch,
				base: github.defaultBranch,
				draft: true,
				body: `Claims [${path}](https://github.com/${owner}/${repo}/blob/${github.defaultBranch}/${path}).`,
			},
		});
		const row = object(await response.json());
		created = {
			number: Number(row.number),
			url: string(row.html_url),
			branch,
			head: `${github.head.owner}/${github.head.repo}`,
			draft: true,
			created: Date.parse(string(row.created_at)),
			updated: Date.parse(string(row.created_at)),
			handedBack: false,
		};
	} catch (error) {
		// Without its PR the claim is invisible on GitHub, so take the branch back.
		deleteBranch(root, remote, branch, sha);
		throw error;
	}

	// Two claimers on different repositories, such as forks, both push; the earliest PR wins.
	const open = pullsFrom(await openPullRequests(github.client, github.repository), branch);
	const first = pullsFrom([...open.filter((pull) => pull.number !== created.number), created], branch)[0];
	if (first.number !== created.number) {
		deleteBranch(root, remote, branch, sha);
		await close(up, created.number);
		throw new Refusal(`${first.url} claimed ${path} first; closed ${created.url}`);
	}
	return created.url;
}

export interface Released {
	branch: string;
	/** The PRs closed with it. */
	closed: string[];
}

/**
 * Release the claim on `path`: delete its branch on `remote` with a lease on
 * the claim commit, then close its open PR. Refuses once the branch has work on it.
 */
export async function releaseQuest(
	root: string,
	path: string,
	remote: string,
	deps: ClaimDependencies,
): Promise<Released> {
	const branch = questBranch(path);
	const up = await upstream(root, remote, deps);
	const tip = gitOutput(root, ["ls-remote", remote, `refs/heads/${branch}`]).split("\t")[0];
	if (!tip) throw new Error(`${remote} has no branch ${branch} to release`);
	ensure(root, remote, tip);
	const parents = gitOutput(root, ["rev-list", "--parents", "-n", "1", tip]).split(" ").slice(1);
	const empty =
		parents.length === 1 &&
		gitOutput(root, ["rev-parse", `${tip}^{tree}`]) === gitOutput(root, ["rev-parse", `${parents[0]}^{tree}`]);
	if (!empty) {
		throw new Refusal(
			`${branch} on ${remote} has work beyond its empty claim commit; close its PR yourself to abandon that work`,
		);
	}

	const pulls: OpenPull[] = [];
	if (up.github) {
		const head = `${up.github.head.owner}/${up.github.head.repo}`.toLowerCase();
		const open = await openPullRequests(up.github.client, up.github.repository);
		pulls.push(...pullsFrom(open, branch).filter((pull) => pull.head?.toLowerCase() === head));
	}
	// Deleting first means the lease decides: a push since the check keeps both the branch and its PR.
	deleteBranch(root, remote, branch, tip);
	for (const pull of pulls) await close(up, pull.number);
	return { branch, closed: pulls.map((pull) => pull.url) };
}

/** How long ago `time` was, roughly: just now, minutes, hours, then days. */
export function ago(now: number, time: number): string {
	const minutes = Math.max(0, Math.round((now - time) / 60_000));
	if (minutes === 0) return "just now";
	const [count, unit] =
		minutes < 60
			? [minutes, "minute"]
			: minutes < 48 * 60
				? [Math.round(minutes / 60), "hour"]
				: [Math.round(minutes / 1440), "day"];
	return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** A claim for a person deciding whether to wait, take it over, or pick other work. */
export function describe(branch: string, pull: OpenPull | null, now: number): string {
	if (pull === null) return `branch ${branch}, with no open PR`;
	// A draft without the hand-back heading is still its starter's; the others wait on the maintainer.
	const state = !pull.draft ? "ready for review" : pull.handedBack ? "draft, decisions needed" : "draft";
	return `${pull.url} (${state}, last active ${ago(now, pull.updated)})`;
}

/** Close a PR on the upstream repository. */
async function close(up: Upstream, number: number): Promise<void> {
	await up.github!.client.request(`${repositoryPath(up.github!.repository)}/pulls/${number}`, {
		method: "PATCH",
		body: { state: "closed" },
	});
}

/** The upstream default branch's tip, fetched so a commit can build on it. */
function remoteHead(root: string, remote: string): string {
	const sha = gitOutput(root, ["ls-remote", remote, "HEAD"]).split("\t")[0];
	if (!sha) throw new Error(`${remote} has no default branch to build a claim on`);
	ensure(root, remote, sha);
	return sha;
}

/** Make `sha` from `remote` available locally. */
function ensure(root: string, remote: string, sha: string): void {
	if (!succeeds(root, ["cat-file", "-e", `${sha}^{commit}`])) {
		gitOutput(root, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", remote, sha]);
	}
}

/** Delete `branch` on `remote` only while its tip is still `sha`. */
function deleteBranch(root: string, remote: string, branch: string, sha: string): void {
	push(
		root,
		remote,
		[`--force-with-lease=refs/heads/${branch}:${sha}`, `:refs/heads/${branch}`],
		`${branch} moved on ${remote}, so it was kept`,
	);
}

/**
 * Push without forcing. A rejection, which means the remote ref is not what
 * this push expects, is a `Refusal` with `rejected`; anything else fails.
 */
function push(root: string, remote: string, args: string[], rejected: string): void {
	try {
		execFileSync("git", ["-C", root, "push", "--porcelain", remote, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
	} catch (error) {
		const { stdout, stderr } = error as { stdout?: string; stderr?: string };
		// --porcelain reports each ref on stdout: `!` and `[rejected]` for a ref that is not as expected.
		if (/^!\t.*\t\[rejected\]/m.test(stdout ?? "")) throw new Refusal(rejected);
		throw new Error(`git push to ${remote} failed: ${(stderr || stdout || "").trim()}`);
	}
}

/** Whether a git command exits zero. */
function succeeds(root: string, args: string[]): boolean {
	try {
		gitOutput(root, args);
		return true;
	} catch {
		return false;
	}
}
