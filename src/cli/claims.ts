// Who holds a quest: its claim branch upstream, or an open PR from a branch of
// that name in any repository. Commands that must not disturb held work look
// here first, and `quest start` records a claim the same way.
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

/** The heading that hands a draft back to the maintainer; only its presence matters. */
const HAND_BACK = /^#{2}[ \t]+Decisions needed[ \t]*#*[ \t]*$/im;

/** A quest's branch: its path without `.md`. */
export function questBranch(path: string): string {
	return path.replace(/\.md$/, "");
}

/** An open PR, from any head repository, as the claim checks read it. */
export interface OpenPull {
	number: number;
	url: string;
	branch: string;
	/** The head repository as `owner/repo`, or `null` once a fork is deleted. */
	head: string | null;
	draft: boolean;
	/** Epoch milliseconds. The earliest open PR on a branch holds the claim. */
	created: number;
	/** Epoch milliseconds of the last push, comment, or edit. */
	updated: number;
	/** Its body has a `## Decisions needed` section, so it waits on the maintainer. */
	handedBack: boolean;
}

/** A held quest branch, and the open PR from it if there is one. */
export interface Claim {
	branch: string;
	/** The PR holding the claim: the earliest open one. */
	url: string | null;
	pull: OpenPull | null;
	/** The branch tip upstream; `null` when only a PR, such as one from a fork, holds it. */
	sha: string | null;
}

export interface ClaimDependencies {
	/** Called only when the remote is on GitHub, so other forges need no token. */
	github(): GitHubDependencies;
	warn(message: string): void;
}

/** Where claims live. For a GitHub fork, that is its parent rather than the remote itself. */
export interface Upstream {
	/** The remote's name, or the parent's URL for a fork; git reads upstream branches from it. */
	git: string;
	github: {
		client: GitHub;
		/** Where PRs open and claims are checked. */
		repository: Repository;
		/** The repository the remote pushes to: `repository` itself, or the fork. */
		head: Repository;
		defaultBranch: string;
	} | null;
}

/**
 * The upstream of `remote`. A GitHub repository that is a fork resolves to its
 * parent, reached with the same URL scheme as the remote; anything else is
 * its own upstream with no GitHub side.
 */
export async function upstream(root: string, remote: string, deps: ClaimDependencies): Promise<Upstream> {
	// The configured URL first, so a URL rewrite (`insteadOf`) still names the GitHub repository.
	const configured = gitOutput(root, ["config", "--get", `remote.${remote}.url`]);
	const url = remoteUrl(root, remote);
	const source = githubRepository(configured) ? configured : url;
	const named = githubRepository(source);
	if (named === null) return { git: remote, github: null };

	const client = new GitHub(deps.github());
	const info = object(await (await client.request(repositoryPath(named))).json());
	const self = { owner: string(object(info.owner).login), repo: string(info.name) };
	if (info.fork === true && info.parent !== undefined) {
		const parent = object(info.parent);
		return {
			// Reach the parent the way the remote is reached, so the same credentials work.
			git: string(/^https:/.test(source) ? parent.clone_url : parent.ssh_url),
			github: {
				client,
				repository: { owner: string(object(parent.owner).login), repo: string(parent.name) },
				head: self,
				defaultBranch: string(parent.default_branch),
			},
		};
	}
	return {
		git: remote,
		github: { client, repository: self, head: self, defaultBranch: string(info.default_branch) },
	};
}

/** The REST path of a repository. */
export function repositoryPath(repository: Repository): string {
	return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

/** The `quest/*` branches on `remote` (a name or URL), with their tips. Plain git, so it works with any forge. */
export function remoteBranches(root: string, remote: string): Map<string, string> {
	const branches = new Map<string, string>();
	for (const line of gitOutput(root, ["ls-remote", remote, "refs/heads/quest/*"]).split("\n")) {
		if (line === "") continue;
		const [sha, ref] = line.split("\t");
		branches.set(ref.replace(/^refs\/heads\//, ""), sha);
	}
	return branches;
}

/** Every open PR in `repository`, from any head repository. */
export async function openPullRequests(github: GitHub, repository: Repository): Promise<OpenPull[]> {
	const rows = await github.all(`${repositoryPath(repository)}/pulls?state=open&per_page=100`);
	return rows.map((row) => {
		const head = object(row.head);
		const repo = head.repo === null ? null : object(head.repo);
		return {
			number: Number(row.number),
			url: string(row.html_url),
			branch: string(head.ref),
			head: repo === null ? null : string(repo.full_name),
			draft: row.draft === true,
			created: Date.parse(string(row.created_at)),
			updated: Date.parse(string(row.updated_at)),
			handedBack: typeof row.body === "string" && HAND_BACK.test(row.body),
		};
	});
}

/** The open PRs from `branch`, earliest first: the first one holds the claim. */
export function pullsFrom(pulls: OpenPull[], branch: string): OpenPull[] {
	return pulls.filter((pull) => pull.branch === branch).sort((a, b) => a.created - b.created || a.number - b.number);
}

/**
 * Which of `branches` someone holds: pushed upstream, or the head of an open
 * PR there. Without the remote it warns and checks nothing; off GitHub it
 * checks branches only.
 */
export async function claims(
	root: string,
	remote: string,
	branches: string[],
	deps: ClaimDependencies,
): Promise<Claim[]> {
	try {
		remoteUrl(root, remote);
	} catch {
		deps.warn(`no ${remote} remote, so claims were not checked`);
		return [];
	}
	const up = await upstream(root, remote, deps);
	if (up.github === null) deps.warn(`${remote} is not on GitHub, so only its branches were checked for claims`);
	return held(root, up, branches);
}

/** Which of `branches` someone holds upstream, sorted by branch. */
export async function held(root: string, up: Upstream, branches: string[]): Promise<Claim[]> {
	const wanted = new Set(branches);
	const tips = remoteBranches(root, up.git);
	const pulls = up.github ? await openPullRequests(up.github.client, up.github.repository) : [];
	const result: Claim[] = [];
	for (const branch of [...wanted].sort()) {
		const pull = pullsFrom(pulls, branch)[0] ?? null;
		const sha = tips.get(branch) ?? null;
		if (pull !== null || sha !== null) result.push({ branch, url: pull?.url ?? null, pull, sha });
	}
	return result;
}

/** Run git in `root` and return its trimmed stdout; an unset config key is empty rather than an error. */
export function gitOutput(root: string, args: string[]): string {
	try {
		return execFileSync("git", ["-C", root, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		}).trim();
	} catch (error) {
		if (args[0] === "config" && (error as { status?: number }).status === 1) return "";
		const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
		throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
	}
}
