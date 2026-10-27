// `quest land`: a batched merge gate a repository runs from its own CI. Three
// phases keep the push credential away from PR code. `resolve` reads the queue
// from GitHub; `check` builds the queue into a chain of squash commits on the
// base and runs the repository's check on it, with no push credential; `push`
// rebuilds the same chain, lands the prefix that passed, and ejects what cannot
// land.
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { repositoryPath } from "./claims";
import {
	GitHub,
	GitHubDeadline,
	type GitHubDependencies,
	object,
	type ObjectValue,
	type Repository,
	type RequiredCheck,
	array,
	requirements,
	string,
} from "./github";
import { classifyCheck } from "./status";

/** The check a gated base requires. Nothing reports it on a PR head, so GitHub's auto-merge only waits. */
export const LAND_CHECK = "quest land";

/** The auto-merge commit body trailer that pins the head `quest merge --land` approved. */
const PIN = "Quest-Land-Head";

/** The auto-merge commit body that queues `sha`. */
export function pin(sha: string): string {
	return `${PIN}: ${sha}`;
}

/** The head an auto-merge commit body pins, if any. */
function pinned(body: string): string | null {
	return new RegExp(`^${PIN}: ([0-9a-f]{40})$`, "m").exec(body)?.[1] ?? null;
}

/** Why the gate removed a PR from the queue; `quest status` prints it under `landing-stopped`. */
export type Reason =
	| "merge_conflict"
	| "failed_checks"
	| "checks_pending"
	| "review_required"
	| "changes_requested"
	| "unresolved_conversations"
	| "no_maintainer_edits"
	| "head_moved"
	| "not_pinned"
	| "push_failed";

/** The hidden line an ejection comment carries, which `quest status` reads. */
export const EJECTED = /^<!-- quest land: ([a-z_]+) -->$/m;

/** A queued PR, as the queue resolved it. */
export interface Entry {
	/** GraphQL node ID. */
	id: string;
	number: number;
	url: string;
	title: string;
	/** When auto-merge was enabled: the queue order, and how a later ejection tells a re-queued PR apart. */
	enabledAt: string;
	/** The pinned head, which the chain builds and the landing leases. */
	head: string;
	/** `owner/name` of the repository holding the head branch, which the landing moves. */
	repository: string;
	branch: string;
}

export interface Ejection {
	id: string;
	number: number;
	url: string;
	enabledAt: string;
	reason: Reason;
	/** Why, for the PR's comment. */
	detail: string;
}

/** What `resolve` hands the other phases. */
export interface Plan {
	/** `owner/name`. */
	repository: string;
	base: { ref: string; sha: string };
	/** Queued PRs in enqueue order. */
	queue: Entry[];
	eject: Ejection[];
}

/** One run of the check command, on the chain prefix holding these PRs. */
export interface Tested {
	numbers: number[];
	tree: string;
	passed: boolean;
}

/** What `check` hands `push`: each prefix it tested, in order. */
export interface Result {
	base: string;
	checks: Tested[];
}

/** A page of a commit's check runs and commit statuses, with the app behind each run. */
const CONTEXTS = `pageInfo { hasNextPage endCursor }
	nodes {
		__typename
		... on CheckRun { name status conclusion detailsUrl checkSuite { app { databaseId } } }
		... on StatusContext { context state targetUrl }
	}`;

const QUEUE = `query($owner: String!, $name: String!, $base: String!, $qualified: String!, $after: String) {
	repository(owner: $owner, name: $name) {
		ref(qualifiedName: $qualified) { target { oid } }
		queue:pullRequests(states: OPEN, baseRefName: $base, first: 100, after: $after) {
			pageInfo { hasNextPage endCursor }
			nodes {
				id number url title isDraft headRefName headRefOid maintainerCanModify reviewDecision
				headRepository { nameWithOwner }
				autoMergeRequest { enabledAt commitBody }
				commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) { ${CONTEXTS} } } } } }
			}
		}
	}
}`;

/** The pages of a commit's checks after the first. */
const MORE_CONTEXTS = `query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
	repository(owner: $owner, name: $name) {
		object(oid: $oid) { ... on Commit { statusCheckRollup { contexts(first: 100, after: $after) { ${CONTEXTS} } } } }
	}
}`;

/**
 * The ruleset rule types the gate upholds although its push bypasses them, and how: each PR's
 * review decision, review threads, and required checks are its own to enforce, and the rest its
 * push satisfies.
 */
export const UPHELD: Record<string, string> = {
	creation: "the gate never creates the base",
	update: "only the gate's push, which the rule must let bypass, updates the base",
	deletion: "the gate never deletes the base",
	non_fast_forward: "the gate only fast-forwards the base",
	required_linear_history: "the gate lands squash commits in a line",
	pull_request:
		"each PR's review decision must not block it, and its review threads must be resolved if the rule says so",
	required_status_checks: "each required check must pass on each PR's head, from the app the rule names",
	copilot_code_review: "it requests a review and blocks nothing",
};

/** What `rule` sets that the gate does not uphold, or null when it upholds all of it. */
function unheld(rule: ObjectValue): string | null {
	const type = string(rule.type);
	if (!(type in UPHELD)) return type;
	if (type !== "pull_request") return null;
	// The review decision covers approvals, code owners, and stale reviews, but not these.
	const parameters = rule.parameters == null ? {} : object(rule.parameters);
	const methods = parameters.allowed_merge_methods;
	const reviewers = parameters.required_reviewers;
	const settings = [
		parameters.require_last_push_approval === true && "require_last_push_approval",
		Array.isArray(methods) && !methods.includes("squash") && "allowed_merge_methods without squash",
		Array.isArray(reviewers) && reviewers.length > 0 && "required_reviewers",
	].filter((setting) => setting !== false);
	return settings.length > 0 ? `${type} (${settings.join(", ")})` : null;
}

/**
 * The classic branch protection settings the gate upholds although its push bypasses them, and
 * how. Only an admin's push bypasses classic protection, and `enforce_admins` stops even that one.
 */
export const UPHELD_CLASSIC: Record<string, string> = {
	required_status_checks:
		"each required check must pass on each PR's head, from the app it names, and the gate checks the chain on the current base",
	required_pull_request_reviews: "each PR's review decision must not block it",
	required_conversation_resolution: "each PR's review threads must be resolved",
	required_linear_history: "the gate lands squash commits in a line",
	block_creations: "the gate never creates the base",
	allow_force_pushes: "it only loosens the base",
	allow_deletions: "it only loosens the base",
	allow_fork_syncing: "it only loosens a locked base",
};

/** The settings of a base's classic protection that the gate does not uphold. */
function unheldClassic(protection: ObjectValue): string[] {
	return Object.entries(protection).flatMap(([setting, value]) => {
		if (setting === "url") return [];
		// A setting is on unless it says it is off; one without `enabled`, such as `restrictions`, is on when present.
		if (value == null || object(value).enabled === false) return [];
		if (!(setting in UPHELD_CLASSIC)) return [setting];
		// As for rulesets, the review decision does not cover approval of the last push.
		return setting === "required_pull_request_reviews" && object(value).require_last_push_approval === true
			? [`${setting} (require_last_push_approval)`]
			: [];
	});
}

/**
 * The base's classic protection, or null when it has none. Reading it needs administration read,
 * and an unreadable protection is never taken as none.
 */
async function classicProtection(github: GitHub, repository: Repository, ref: string): Promise<ObjectValue | null> {
	const path = `${repositoryPath(repository)}/branches/${encodeURIComponent(ref)}/protection`;
	const unreadable = (why: string) =>
		new Error(
			`cannot read ${repository.owner}/${repository.repo}'s classic branch protection on ${ref}, which needs administration read (a GitHub App's "Administration: read", or a token with admin rights): ${why}`,
		);
	let response: Response;
	try {
		response = await github.request(path, { allow: [404] });
	} catch (error) {
		if (error instanceof GitHubDeadline || !(error instanceof Error)) throw error;
		throw unreadable(error.message);
	}
	const body = object(await response.json());
	if (response.status === 200) return body;
	if (body.message === "Branch not protected") return null;
	throw unreadable(`GitHub HTTP 404; ${String(body.message)}`);
}

/** A page of a PR's review threads, by its node ID. */
const THREADS = `query($id: ID!, $after: String) {
	node(id: $id) { ... on PullRequest { reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { isResolved } } } }
}`;

/** How many of a PR's review threads are unresolved. */
async function unresolved(github: GitHub, id: string): Promise<number> {
	let count = 0;
	for (let after: string | null = null; ;) {
		const threads = object(object(object((await github.graphql(THREADS, { id, after })).node).reviewThreads));
		count += array(threads.nodes).filter((thread) => thread.isResolved !== true).length;
		const info = object(threads.pageInfo);
		if (info.hasNextPage !== true) return count;
		after = string(info.endCursor);
	}
}

/**
 * Read the queue: open PRs to `base` with auto-merge enabled, in the order it
 * was enabled. A PR is queued while its auto-merge commit body pins its current
 * head; the rest of the auto-merging PRs are ejected with a reason.
 */
export async function resolveQueue(
	repository: Repository,
	base: string | undefined,
	deps: GitHubDependencies,
): Promise<Plan> {
	const github = new GitHub(deps);
	const name = `${repository.owner}/${repository.repo}`;
	const ref =
		base ??
		string(
			object(
				object(
					(
						await github.graphql(
							"query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } } }",
							{ owner: repository.owner, name: repository.repo },
						)
					).repository,
				).defaultBranchRef,
			).name,
		);
	const needs = await requirements(github, repository, ref);
	if (!needs.checks.some((check) => check.name === LAND_CHECK)) {
		throw new Error(
			`${name}'s ${ref} does not require the ${LAND_CHECK} check, so GitHub could merge a queued PR around the gate`,
		);
	}
	const refused = needs.rules.flatMap((rule) => {
		const what = unheld(rule);
		return what === null ? [] : [`${what} from ruleset ${String(rule.ruleset_id)}`];
	});
	if (refused.length > 0) {
		throw new Error(
			`${name}'s ${ref} has ruleset rules the gate does not uphold, and its push bypasses them: ${refused.join("; ")}. It upholds only ${Object.keys(UPHELD).join(", ")}`,
		);
	}
	// Classic protection's required checks are already among `needs.checks`.
	const classic = needs.classic ? await classicProtection(github, repository, ref) : null;
	const unmodeled = classic === null ? [] : unheldClassic(classic);
	if (unmodeled.length > 0) {
		throw new Error(
			`${name}'s ${ref} has classic branch protection settings the gate does not uphold, and its push bypasses them: ${unmodeled.join(", ")}. It upholds only ${Object.keys(UPHELD_CLASSIC).join(", ")}`,
		);
	}
	const resolution =
		(classic?.required_conversation_resolution != null &&
			object(classic.required_conversation_resolution).enabled === true) ||
		needs.rules.some(
			(rule) =>
				rule.type === "pull_request" &&
				rule.parameters != null &&
				object(rule.parameters).required_review_thread_resolution === true,
		);
	const required = needs.checks.filter((check) => check.name !== LAND_CHECK);

	let sha: string | undefined;
	const nodes: ObjectValue[] = [];
	let after: string | null = null;
	do {
		const data = await github.graphql(QUEUE, {
			owner: repository.owner,
			name: repository.repo,
			base: ref,
			qualified: `refs/heads/${ref}`,
			after,
		});
		if (data.repository === null) throw new Error(`cannot read ${name}; check the repository and token`);
		const repo = object(data.repository);
		if (repo.ref === null) throw new Error(`${name} has no branch ${ref}`);
		sha ??= string(object(object(repo.ref).target).oid);
		const page = object(repo.queue);
		nodes.push(...array(page.nodes));
		const info = object(page.pageInfo);
		after = info.hasNextPage === true ? string(info.endCursor) : null;
	} while (after !== null);

	const plan: Plan = { repository: name, base: { ref, sha: sha! }, queue: [], eject: [] };
	const landing = nodes.filter((node) => node.autoMergeRequest !== null && node.isDraft !== true);
	const order = (node: ObjectValue) => string(object(node.autoMergeRequest).enabledAt);
	landing.sort((a, b) => order(a).localeCompare(order(b)) || Number(a.number) - Number(b.number));
	for (const node of landing) {
		const request = object(node.autoMergeRequest);
		const head = string(node.headRefOid);
		const holder = node.headRepository === null ? null : string(object(node.headRepository).nameWithOwner);
		const entry: Entry = {
			id: string(node.id),
			number: Number(node.number),
			url: string(node.url),
			title: string(node.title),
			enabledAt: string(request.enabledAt),
			head,
			repository: holder ?? "",
			branch: string(node.headRefName),
		};
		const eject = (reason: Reason, detail: string) =>
			plan.eject.push({
				id: entry.id,
				number: entry.number,
				url: entry.url,
				enabledAt: entry.enabledAt,
				reason,
				detail,
			});
		const approved = pinned(typeof request.commitBody === "string" ? request.commitBody : "");
		if (approved === null) {
			eject("not_pinned", "auto-merge was enabled without `quest merge --land`, which pins the head to land");
		} else if (approved !== head) {
			eject("head_moved", `its head moved from ${approved} to ${head} after it was queued`);
		} else if (holder === null) {
			eject("no_maintainer_edits", "its head repository was deleted, so the gate cannot move its head");
		} else if (holder.toLowerCase() !== name.toLowerCase() && node.maintainerCanModify !== true) {
			eject(
				"no_maintainer_edits",
				"it comes from a fork that does not allow edits by maintainers, so the gate cannot move its head; allow them and land it again",
			);
		} else if (node.reviewDecision === "REVIEW_REQUIRED") {
			eject("review_required", "it still needs an approving review");
		} else if (node.reviewDecision === "CHANGES_REQUESTED") {
			eject("changes_requested", "a reviewer requested changes");
		} else if (resolution && (await unresolved(github, entry.id)) > 0) {
			eject("unresolved_conversations", "it has unresolved review threads; resolve them and land it again");
		} else {
			const unmet = checks(await contexts(github, repository, node), required);
			if (unmet.failing.length > 0) {
				eject("failed_checks", `required checks failed on its head: ${unmet.failing.join(", ")}`);
			} else if (unmet.pending.length > 0) {
				eject(
					"checks_pending",
					`required checks had not passed on its head when the gate ran: ${unmet.pending.join(", ")}; land it again once they pass`,
				);
			} else {
				plan.queue.push(entry);
			}
		}
	}
	return plan;
}

/**
 * Every check run and commit status on a PR node's head: the queue's first page, then the rest by
 * the head's SHA, which also reads them all when the head moved between the queue's fields.
 */
async function contexts(github: GitHub, repository: Repository, node: ObjectValue): Promise<ObjectValue[]> {
	const head = string(node.headRefOid);
	const commit = object(object(array(object(node.commits).nodes)[0]).commit);
	const found: ObjectValue[] = [];
	let rollup = commit.oid === head ? commit.statusCheckRollup : undefined;
	let after: string | null = null;
	for (;;) {
		if (rollup === undefined) {
			const data = await github.graphql(MORE_CONTEXTS, {
				owner: repository.owner,
				name: repository.repo,
				oid: head,
				after,
			});
			const target = object(data.repository).object;
			if (target === null) throw new Error(`${string(node.url)}'s head ${head} is missing`);
			rollup = object(target).statusCheckRollup;
		}
		if (rollup === null) return found;
		const page = object(object(rollup).contexts);
		found.push(...array(page.nodes));
		const info = object(page.pageInfo);
		if (info.hasNextPage !== true) return found;
		after = string(info.endCursor);
		rollup = undefined;
	}
}

/** The required checks a head failed, and those pending or not yet reported, each from its app. */
function checks(contexts: ObjectValue[], required: RequiredCheck[]): { failing: string[]; pending: string[] } {
	const failing: string[] = [];
	const pending: string[] = [];
	for (const need of required) {
		let result: "passed" | "failing" | "pending" = "pending";
		let reported = false;
		for (const context of contexts) {
			const { check, outcome } = classifyCheck(context);
			if (check.name !== need.name || (need.app !== null && appOf(context) !== need.app)) continue;
			// A name reported twice, as by a rerun, counts only once every report passes.
			if (!reported || result === "passed") result = outcome;
			reported = true;
		}
		const name = need.app === null ? need.name : `${need.name} (from app ${need.app})`;
		if (result === "failing") failing.push(name);
		else if (result === "pending") pending.push(name);
	}
	return { failing: failing.sort(), pending: pending.sort() };
}

/** The GitHub App behind a check run; a commit status has none the gate can verify. */
function appOf(context: ObjectValue): number | null {
	if (context.__typename !== "CheckRun" || context.checkSuite == null) return null;
	const app = object(context.checkSuite).app;
	return app == null ? null : Number(object(app).databaseId);
}

/** A queued PR's squash commit on the chain. */
interface Link {
	entry: Entry;
	commit: string;
	tree: string;
}

/** The queue built onto the base, in order, without the PRs that conflict. */
interface Chain {
	links: Link[];
	conflicts: { entry: Entry; files: string[] }[];
}

/**
 * Fetch the base and every queued head, then squash each head in turn onto the
 * chain in a scratch worktree inside the git directory, resolving quest files
 * with `quest resolve`. A PR that still conflicts is left out. The same plan
 * builds the same trees in every phase.
 */
function build(root: string, plan: Plan): Chain {
	const probe = spawnSync("quest", ["help", "resolve"], { stdio: "ignore" });
	if (probe.status !== 0) {
		throw new Error("quest land merges quest files with `quest resolve`, so `quest` must be on PATH");
	}
	git(root, ["fetch", "--quiet", "--no-tags", "origin", plan.base.sha, ...plan.queue.map((entry) => entry.head)]);
	const dir = resolve(root, git(root, ["rev-parse", "--git-path", "quest-land"]));
	// The driver runs from the git directory, not the chain's worktree, where a
	// queued PR's `bunfig.toml` or `.env` would configure the trusted `quest`.
	const trusted = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	const driver = `d=$PWD && cd '${trusted.replaceAll("'", "'\\''")}' && quest resolve "$d"/%A "$d"/%O "$d"/%B`;
	// A crashed run can leave its worktree registered.
	tryGit(root, ["worktree", "remove", "--force", dir]);
	git(root, ["worktree", "prune"]);
	git(root, ["worktree", "add", "--quiet", "--detach", dir, plan.base.sha]);
	const chain: Chain = { links: [], conflicts: [] };
	try {
		for (const entry of plan.queue) {
			const merged = tryGit(dir, ["-c", `merge.quest.driver=${driver}`, "merge", "--squash", entry.head]);
			if (merged.status !== 0) {
				const files = lines(git(dir, ["diff", "--name-only", "--diff-filter=U"]));
				if (files.length === 0)
					throw new Error(`git merge --squash ${entry.head} failed: ${merged.stderr.trim()}`);
				chain.conflicts.push({ entry, files });
				git(dir, ["reset", "--quiet", "--hard", "HEAD"]);
				continue;
			}
			const author = authorOf(dir, plan.base.sha, entry.head);
			git(dir, ["commit", "--quiet", "--allow-empty", "-F", "-"], {
				input: message(dir, plan.base.sha, entry),
				env: { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email },
			});
			chain.links.push({
				entry,
				commit: git(dir, ["rev-parse", "HEAD"]),
				tree: git(dir, ["rev-parse", "HEAD^{tree}"]),
			});
		}
	} finally {
		git(root, ["worktree", "remove", "--force", dir]);
	}
	return chain;
}

/** The squash's author: the author of the PR's first commit, as git recorded it. */
function authorOf(dir: string, base: string, head: string): { name: string; email: string } {
	const own = lines(git(dir, ["log", "--reverse", "--no-merges", "--format=%an%x00%ae", `${base}..${head}`]));
	const [name, email] = (own[0] ?? git(dir, ["log", "-1", "--format=%an%x00%ae", head])).split("\0");
	return { name, email };
}

/**
 * GitHub's squash message: the title and number, each commit's message as a
 * bullet, and a Co-authored-by trailer for every other author.
 */
function message(dir: string, base: string, entry: Entry): string {
	const range = `${base}..${entry.head}`;
	const bodies = git(dir, ["log", "--reverse", "--no-merges", "--format=%B%x00", range])
		.split("\0")
		.map((body) => body.trim())
		.filter((body) => body !== "");
	const author = authorOf(dir, base, entry.head);
	const others = lines(git(dir, ["log", "--no-merges", "--format=%an <%ae>", range]));
	const trailers = lines(
		git(dir, ["log", "--no-merges", "--format=%(trailers:key=Co-authored-by,valueonly,separator=%x0A)", range]),
	);
	const coauthors = [...new Set([...others, ...trailers])].filter(
		(person) => person !== `${author.name} <${author.email}>`,
	);
	// Trailers already in a commit's message would repeat at the end.
	const kept = bodies.map((body) =>
		body
			.split("\n")
			.filter((line) => !/^co-authored-by:/i.test(line))
			.join("\n")
			.trim(),
	);
	return [
		`${entry.title} (#${entry.number})`,
		...kept.map((body) => `* ${body}`),
		...(coauthors.length > 0 ? [coauthors.map((person) => `Co-authored-by: ${person}`).join("\n")] : []),
	].join("\n\n");
}

/**
 * Build the chain and run `command` in `root` on its tip. When it fails, run it
 * on the first half of the chain, and so on, until a prefix passes or a single
 * PR fails alone. The command's output goes to `stderr`.
 */
export async function checkQueue(
	root: string,
	plan: Plan,
	command: string[],
	stderr: (text: string) => void,
): Promise<Result> {
	const chain = build(root, plan);
	for (const { entry, files } of chain.conflicts) {
		stderr(`quest land: #${entry.number} conflicts with the PRs before it in ${files.join(", ")}\n`);
	}
	const checks: Tested[] = [];
	for (let count = chain.links.length; count > 0; count = Math.ceil(count / 2)) {
		const tip = chain.links[count - 1];
		const numbers = chain.links.slice(0, count).map((link) => link.entry.number);
		git(root, ["checkout", "--quiet", "--force", "--detach", tip.commit]);
		stderr(`quest land: checking ${numbers.map((number) => `#${number}`).join(" ")} at ${tip.commit}\n`);
		const passed = (await execute(root, command, stderr)) === 0;
		checks.push({ numbers, tree: tip.tree, passed });
		if (passed || count === 1) break;
	}
	return { base: plan.base.sha, checks };
}

/** Run `command` in `cwd` with both of its output streams sent to `stderr`, resolving its exit code. */
function execute(cwd: string, command: string[], stderr: (text: string) => void): Promise<number> {
	return new Promise((done, fail) => {
		const child = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout.on("data", (chunk: Buffer) => stderr(chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => stderr(chunk.toString()));
		child.once("error", fail);
		child.once("close", (code) => done(code ?? 1));
	});
}

/**
 * Rebuild the chain, check that `result` tested exactly its prefixes, eject
 * what cannot land, then land the prefix that passed: move each PR's branch to
 * its squash commit with a lease on the head that was tested, and fast-forward
 * the base to the last one. A head that moved stops the landing; the prefix
 * before it lands only if a check passed on exactly that prefix.
 */
export async function pushQueue(
	root: string,
	plan: Plan,
	result: Result,
	run: string | undefined,
	deps: GitHubDependencies,
): Promise<string[]> {
	const chain = build(root, plan);
	validate(chain, plan, result);
	const ejections = [...plan.eject];
	const ejectLink = (entry: Entry, reason: Reason, detail: string) => ejections.push(ejection(entry, reason, detail));
	for (const { entry, files } of chain.conflicts) {
		ejectLink(
			entry,
			"merge_conflict",
			`it conflicts with the base or the PRs queued before it in ${files.join(", ")}; merge the base, push, and land it again`,
		);
	}
	const last = result.checks.at(-1);
	if (last !== undefined && !last.passed && last.numbers.length === 1) {
		ejectLink(
			chain.links[0].entry,
			"failed_checks",
			"the repository's check failed with it alone on the base; fix it and land it again",
		);
	}
	const passed = new Set(result.checks.filter((tested) => tested.passed).map((tested) => tested.numbers.length));
	let count = last?.passed ? last.numbers.length : 0;
	if (count > 0) {
		const base = remoteHead(root, "origin", plan.base.ref);
		if (base !== plan.base.sha)
			throw new Error(`${plan.base.ref} moved from ${plan.base.sha} to ${base}; nothing landed`);
		for (let index = 0; index < count; index++) {
			const { entry } = chain.links[index];
			const head = remoteHead(root, remoteOf(plan, entry), entry.branch);
			if (head === entry.head) continue;
			ejectLink(
				entry,
				"head_moved",
				`its head moved from ${entry.head} to ${head ?? "nothing"} while the gate checked it`,
			);
			// A later PR can mask an earlier one's failure, so only a prefix checked on its own lands.
			count = passed.has(index) ? index : 0;
			break;
		}
	}
	// One line per PR: `landed <number> <commit>`, `ejected <number> <reason>`, or `withdrawn <number>`.
	const output: string[] = [];
	if (count > 0) {
		// The queue can change while the gate checks it: land only PRs still queued as they were.
		const [owner, repo] = plan.repository.split("/");
		const fresh = await resolveQueue({ owner, repo }, plan.base.ref, deps);
		for (let index = 0; index < count; index++) {
			const { entry } = chain.links[index];
			const now = fresh.queue.find((queued) => queued.number === entry.number);
			if (now?.head === entry.head && now.enabledAt === entry.enabledAt) continue;
			const ejected = fresh.eject.find((ejected) => ejected.number === entry.number);
			if (ejected !== undefined) ejections.push(ejected);
			// Leave it unqueued, but report it so the rest of the queue gets another run.
			else output.push(`withdrawn ${entry.number}`);
			count = passed.has(index) ? index : 0;
			break;
		}
	}

	const github = new GitHub(deps);
	for (const ejection of ejections) {
		if (await eject(github, plan, ejection, run)) output.push(`ejected ${ejection.number} ${ejection.reason}`);
	}
	if (count === 0) return output;

	const links = chain.links.slice(0, count);
	const refused = await landLinks(root, plan, links, deps);
	if (refused === null) {
		for (const link of links) output.push(`landed ${link.entry.number} ${link.commit}`);
		return output;
	}
	// A refused push stops the landing; it lands again on the next run, without the PR that stopped it.
	const stop = async (entry: Entry, reason: Reason, detail: string) => {
		if (await eject(github, plan, ejection(entry, reason, detail), run)) {
			output.push(`ejected ${entry.number} ${reason}`);
		}
		return output;
	};
	for (const { entry } of refused.links) {
		const head = remoteHead(root, remoteOf(plan, entry), entry.branch);
		if (head !== entry.head) {
			return stop(
				entry,
				"head_moved",
				`its head moved from ${entry.head} to ${head ?? "nothing"} while the gate checked it`,
			);
		}
	}
	const [first] = refused.links;
	if (refused.links.length === 1 && !local(plan, first.entry)) {
		return stop(first.entry, "push_failed", `the gate could not move its head: ${refused.stderr}`);
	}
	throw new Error(`the landing push failed, so nothing landed: ${refused.stderr}`);
}

/** How long `push` waits for GitHub to show the moved heads before it backs out. */
const SYNC_MS = 60_000;

/**
 * Move each PR's branch to its squash commit, then fast-forward the base, all or
 * nothing. GitHub marks a PR merged only when the base reaches a head it has
 * already synced: a head that moves in the base's push, or syncs after it,
 * leaves the PR closed or open instead, so the base waits for every head.
 * Heads that moved go back when a later step fails: the gate's own head pushes
 * must not dequeue a PR that did not land. Returns the PRs whose head push git
 * refused, none when the base push failed, with its error, or null once
 * everything landed.
 */
async function landLinks(
	root: string,
	plan: Plan,
	links: Link[],
	deps: GitHubDependencies,
): Promise<{ links: Link[]; stderr: string } | null> {
	const moved: Link[] = [];
	let refused: { links: Link[]; stderr: string } | null = null;
	for (const link of links.filter((link) => !local(plan, link.entry))) {
		const pushed = tryGit(root, [
			"push",
			"--quiet",
			remoteOf(plan, link.entry),
			...move(link, link.commit, link.entry.head),
		]);
		if (pushed.status !== 0) {
			refused = { links: [link], stderr: pushed.stderr.trim() };
			break;
		}
		moved.push(link);
	}
	const own = links.filter((link) => local(plan, link.entry));
	if (refused === null && own.length > 0) {
		const pushed = tryGit(root, [
			"push",
			"--quiet",
			"--atomic",
			"origin",
			...own.flatMap((link) => move(link, link.commit, link.entry.head)),
		]);
		if (pushed.status === 0) moved.push(...own);
		else refused = { links: own, stderr: pushed.stderr.trim() };
	}
	if (refused === null) {
		const unsynced = await synced(deps, links);
		if (unsynced !== null) refused = { links: [], stderr: unsynced };
	}
	if (refused === null) {
		const pushed = tryGit(root, [
			"push",
			"--quiet",
			"origin",
			`${links[links.length - 1].commit}:refs/heads/${plan.base.ref}`,
		]);
		if (pushed.status === 0) return null;
		refused = { links: [], stderr: pushed.stderr.trim() };
	}
	const stuck = moved.filter(
		(link) =>
			tryGit(root, ["push", "--quiet", remoteOf(plan, link.entry), ...move(link, link.entry.head, link.commit)])
				.status !== 0,
	);
	if (stuck.length > 0) {
		throw new Error(
			`the landing push failed (${refused.stderr}), and ${stuck.map((link) => `#${link.entry.number}`).join(", ")} could not move back to the head it had`,
		);
	}
	return refused;
}

/** Wait until GitHub shows each PR's head at its squash commit; otherwise, return why not. */
async function synced(deps: GitHubDependencies, links: Link[]): Promise<string | null> {
	const github = new GitHub(deps, deps.now() + SYNC_MS);
	try {
		for (const link of links) {
			while (true) {
				const data = await github.graphql(
					"query($id: ID!) { node(id: $id) { ... on PullRequest { headRefOid } } }",
					{ id: link.entry.id },
				);
				if (object(data.node).headRefOid === link.commit) break;
				await github.pause(1000);
			}
		}
		return null;
	} catch (error) {
		if (error instanceof GitHubDeadline)
			return `GitHub did not show the moved heads within ${SYNC_MS / 1000} seconds`;
		return `cannot read the moved heads: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/** Remove `entry` from the queue for `reason`. */
function ejection(entry: Entry, reason: Reason, detail: string): Ejection {
	return { id: entry.id, number: entry.number, url: entry.url, enabledAt: entry.enabledAt, reason, detail };
}

/** A refspec that moves a PR's branch to `to`, with a lease on it being at `from`. */
function move(link: Link, to: string, from: string): string[] {
	const ref = `refs/heads/${link.entry.branch}`;
	return [`${to}:${ref}`, `--force-with-lease=${ref}:${from}`];
}

/** Fail unless `result` tested prefixes of this chain on this base, shrinking, with only the last passing. */
function validate(chain: Chain, plan: Plan, result: Result): void {
	const bad = (why: string) => new Error(`the check result does not match the chain: ${why}`);
	if (result.base !== plan.base.sha) throw bad(`it was built on ${result.base}, not ${plan.base.sha}`);
	let previous = Infinity;
	result.checks.forEach((tested, index) => {
		const count = tested.numbers.length;
		if (count === 0 || count >= previous || count > chain.links.length)
			throw bad(`check ${index + 1} is not a shorter prefix`);
		previous = count;
		const prefix = chain.links.slice(0, count);
		if (prefix.some((link, at) => link.entry.number !== tested.numbers[at])) {
			throw bad(`check ${index + 1} lists other PRs`);
		}
		if (prefix[count - 1].tree !== tested.tree) throw bad(`check ${index + 1} tested another tree`);
		if (tested.passed && index !== result.checks.length - 1)
			throw bad(`check ${index + 1} passed but was not the last`);
	});
	if (result.checks.length === 0 && chain.links.length > 0) throw bad("nothing was checked");
	if (result.checks.length > 0 && result.checks[0].numbers.length !== chain.links.length) {
		throw bad("the first check did not cover the whole chain");
	}
}

/**
 * Remove `ejection` from the queue: disable its auto-merge, drop `quest:merge`,
 * and comment with the reason. A PR whose auto-merge was enabled again since
 * the queue was read is a new entry and is left alone. Returns whether it ejected.
 */
async function eject(github: GitHub, plan: Plan, ejection: Ejection, run: string | undefined): Promise<boolean> {
	const data = await github.graphql(
		"query($id: ID!) { node(id: $id) { ... on PullRequest { state autoMergeRequest { enabledAt } } } }",
		{ id: ejection.id },
	);
	const pull = object(data.node);
	if (pull.state !== "OPEN") return false;
	const request = pull.autoMergeRequest === null ? null : object(pull.autoMergeRequest);
	if (request !== null && string(request.enabledAt) !== ejection.enabledAt) return false;
	if (request !== null) {
		await github.graphql(
			"mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }",
			{ id: ejection.id },
		);
	}
	const [owner, repo] = plan.repository.split("/");
	const issue = `${repositoryPath({ owner, repo })}/issues/${ejection.number}`;
	await github.request(`${issue}/labels/${encodeURIComponent("quest:merge")}`, { method: "DELETE", allow: [404] });
	const link = run === undefined ? "" : ` ([run](${run}))`;
	await github.request(`${issue}/comments`, {
		body: {
			body: `quest land removed this pull request from the queue: ${ejection.detail}${link}.\n\n<!-- quest land: ${ejection.reason} -->`,
		},
	});
	return true;
}

/** Whether the PR's head branch is in the base repository, which the landing pushes atomically. */
function local(plan: Plan, entry: Entry): boolean {
	return entry.repository.toLowerCase() === plan.repository.toLowerCase();
}

/** Where to push a PR's head branch: origin, or its fork on GitHub. */
function remoteOf(plan: Plan, entry: Entry): string {
	return local(plan, entry) ? "origin" : `https://github.com/${entry.repository}.git`;
}

/** The commit `branch` is at on `remote`, or null when it is gone. */
function remoteHead(root: string, remote: string, branch: string): string | null {
	const ref = `refs/heads/${branch}`;
	const found = lines(git(root, ["ls-remote", remote, ref])).map((line) => line.split("\t"));
	return found.find(([, name]) => name === ref)?.[0] ?? null;
}

/** Read a plan written by `resolve`, failing on anything malformed. */
export function parsePlan(text: string): Plan {
	const row = object(JSON.parse(text));
	const base = object(row.base);
	const entry = (value: ObjectValue): Entry => ({
		id: string(value.id),
		number: positive(value.number),
		url: string(value.url),
		title: string(value.title),
		enabledAt: string(value.enabledAt),
		head: sha(value.head),
		repository: string(value.repository),
		branch: string(value.branch),
	});
	return {
		repository: string(row.repository),
		base: { ref: string(base.ref), sha: sha(base.sha) },
		queue: array(row.queue).map(entry),
		eject: array(row.eject).map((value) => ({
			id: string(value.id),
			number: positive(value.number),
			url: string(value.url),
			enabledAt: string(value.enabledAt),
			reason: string(value.reason) as Reason,
			detail: string(value.detail),
		})),
	};
}

/** Read a check result, which the untrusted check job wrote, failing on anything malformed. */
export function parseResult(text: string): Result {
	const row = object(JSON.parse(text));
	return {
		base: sha(row.base),
		checks: array(row.checks).map((value) => {
			if (!Array.isArray(value.numbers) || typeof value.passed !== "boolean") {
				throw new Error("invalid check result: expected numbers and passed");
			}
			return { numbers: value.numbers.map(positive), tree: sha(value.tree), passed: value.passed };
		}),
	};
}

function positive(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error("invalid quest land input: expected a positive integer");
	}
	return value;
}

function sha(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
		throw new Error("invalid quest land input: expected a full SHA");
	}
	return value;
}

function lines(text: string): string[] {
	return text.split("\n").filter((line) => line !== "");
}

/** Run git without the repository's hooks, returning its status and output. */
function tryGit(
	cwd: string,
	args: string[],
	options: { input?: string; env?: Record<string, string> } = {},
): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
		cwd,
		encoding: "utf8",
		input: options.input,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
		maxBuffer: 1 << 30,
	});
	if (result.error) throw result.error;
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Run git, failing loudly; returns its trimmed output. */
function git(cwd: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}): string {
	const result = tryGit(cwd, args, options);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}
