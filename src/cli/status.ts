// A pull request's current state on GitHub, as facts for an agent to judge.
import {
	actor,
	array,
	GitHub,
	type GitHubDependencies,
	object,
	type ObjectValue,
	type PullRequest,
	string,
} from "./github";

/**
 * One query covers the PR; each connection pages by its own cursor, and a
 * connection already read in full is skipped on later pages.
 */
const STATUS = `query($owner: String!, $repo: String!, $number: Int!,
	$checks: String, $reviews: String, $threads: String,
	$moreChecks: Boolean!, $moreReviews: Boolean!, $moreThreads: Boolean!) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			url state isDraft headRefOid mergeable mergeStateStatus reviewDecision
			autoMergeRequest { enabledAt mergeMethod enabledBy { login } }
			mergeQueueEntry { state position enqueuedAt }
			reactions(last: 100) { nodes { ...reaction } }
			commits(last: 1) { nodes { commit { oid statusCheckRollup { state
				contexts(first: 100, after: $checks) @include(if: $moreChecks) {
					pageInfo { hasNextPage endCursor }
					nodes {
						__typename
						... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) }
						... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }
					}
				}
			} } } }
			reviews(first: 100, after: $reviews) @include(if: $moreReviews) {
				pageInfo { hasNextPage endCursor }
				nodes { author { login } state submittedAt url commit { oid } reactions(last: 100) { nodes { ...reaction } } }
			}
			reviewThreads(first: 100, after: $threads) @include(if: $moreThreads) {
				pageInfo { hasNextPage endCursor }
				nodes {
					id isResolved isOutdated path line originalLine
					comments(last: 1) { nodes { author { login } url } }
				}
			}
		}
	}
}
fragment reaction on Reaction { content createdAt user { login } }`;

/** Completed check-run conclusions that do not fail; anything else completed fails. */
const PASSING = ["success", "neutral", "skipped"];

export interface Check {
	name: string;
	required: boolean;
	/** The lowercased check-run conclusion or status, or commit-status state. */
	result: string;
	url: string | null;
}

export interface Review {
	reviewer: string;
	/** approved, changes_requested, commented, or dismissed. */
	state: string;
	/** Whether the review was submitted against the current head. */
	current: boolean;
	commit: string | null;
	submittedAt: string;
	url: string;
}

export interface Reaction {
	content: string;
	actor: string;
	createdAt: string;
	/** The PR or review reacted to. */
	url: string;
}

export interface Thread {
	id: string;
	path: string;
	/** The line on the current diff, or the original line once outdated. */
	line: number | null;
	outdated: boolean;
	lastAuthor: string;
	/** The thread's latest comment. */
	url: string;
}

export interface Status {
	url: string;
	state: "open" | "closed" | "merged";
	draft: boolean;
	head: string;
	mergeable: string;
	mergeState: string;
	reviewDecision: string | null;
	autoMerge: { method: string; enabledBy: string; enabledAt: string } | null;
	mergeQueue: { state: string; position: number; enqueuedAt: string } | null;
	checks: { state: string | null; passed: number; failing: Check[]; pending: Check[] };
	/** Each reviewer's latest submitted review, oldest first. */
	reviews: Review[];
	reactions: Reaction[];
	/** Unresolved review threads, oldest first. */
	threads: Thread[];
}

/** Read the PR's state in one query, plus one per extra page of a long list. */
export async function pullRequestStatus(pr: PullRequest, deps: GitHubDependencies): Promise<Status> {
	const github = new GitHub(deps);
	const cursors: Record<"checks" | "reviews" | "threads", string | null | undefined> = {
		checks: null,
		reviews: null,
		threads: null,
	};
	const contexts: ObjectValue[] = [];
	const reviewNodes: ObjectValue[] = [];
	const threadNodes: ObjectValue[] = [];
	let first: ObjectValue | undefined;
	let rollup: ObjectValue | null = null;
	// A cursor is null to read the first page and undefined once its list is complete.
	const page = (connection: unknown, key: keyof typeof cursors, into: ObjectValue[]) => {
		const list = object(connection);
		into.push(...array(list.nodes));
		const info = object(list.pageInfo);
		cursors[key] = info.hasNextPage === true ? string(info.endCursor) : undefined;
	};
	while (Object.values(cursors).some((cursor) => cursor !== undefined)) {
		const data = await github.graphql(STATUS, {
			owner: pr.owner,
			repo: pr.repo,
			number: pr.number,
			checks: cursors.checks ?? null,
			reviews: cursors.reviews ?? null,
			threads: cursors.threads ?? null,
			moreChecks: cursors.checks !== undefined,
			moreReviews: cursors.reviews !== undefined,
			moreThreads: cursors.threads !== undefined,
		});
		const repository = data.repository;
		if (repository === null) throw new Error(`cannot read ${pr.owner}/${pr.repo}; check the repository and token`);
		const pull = object(repository).pullRequest;
		if (pull === null) throw new Error(`${pr.owner}/${pr.repo}#${pr.number} is not a pull request`);
		const current = object(pull);
		if (first === undefined) first = current;
		else if (current.headRefOid !== first.headRefOid)
			throw new Error("the PR head changed while reading its pages; rerun quest status");
		const commit = object(object(array(object(current.commits).nodes)[0]).commit);
		if (commit.oid !== current.headRefOid)
			throw new Error("the PR head changed during the query; rerun quest status");
		rollup = commit.statusCheckRollup === null ? null : object(commit.statusCheckRollup);
		if (cursors.checks !== undefined) {
			if (rollup === null) cursors.checks = undefined;
			else page(rollup.contexts, "checks", contexts);
		}
		if (cursors.reviews !== undefined) page(current.reviews, "reviews", reviewNodes);
		if (cursors.threads !== undefined) page(current.reviewThreads, "threads", threadNodes);
	}
	return summarize(first!, rollup, contexts, reviewNodes, threadNodes);
}

function summarize(
	pull: ObjectValue,
	rollup: ObjectValue | null,
	contexts: ObjectValue[],
	reviewNodes: ObjectValue[],
	threadNodes: ObjectValue[],
): Status {
	const head = string(pull.headRefOid);
	const url = string(pull.url);
	const checks = {
		state: rollup === null ? null : lower(rollup.state),
		passed: 0,
		failing: [],
		pending: [],
	} as Status["checks"];
	for (const context of contexts) {
		const run = context.__typename === "CheckRun";
		const check: Check = {
			name: string(run ? context.name : context.context),
			required: context.isRequired === true,
			result:
				run && context.status !== "COMPLETED"
					? lower(context.status)
					: lower(run ? context.conclusion : context.state),
			url: optional(run ? context.detailsUrl : context.targetUrl),
		};
		if (run ? context.status !== "COMPLETED" : ["pending", "expected"].includes(check.result))
			checks.pending.push(check);
		else if (run ? PASSING.includes(check.result) : check.result === "success") checks.passed++;
		else checks.failing.push(check);
	}

	const reactions: Reaction[] = [];
	const reacted = (owner: ObjectValue, target: string) => {
		for (const row of array(object(owner.reactions).nodes))
			reactions.push({
				content: lower(row.content),
				actor: actor(row.user),
				createdAt: string(row.createdAt),
				url: target,
			});
	};
	reacted(pull, url);
	// A pending review is the viewer's unsubmitted draft, not a review.
	const submitted = reviewNodes.filter((row) => row.state !== "PENDING");
	const latest = new Map<string, Review>();
	for (const row of submitted) {
		reacted(row, string(row.url));
		const reviewer = actor(row.author);
		const commit = row.commit === null ? null : string(object(row.commit).oid);
		latest.delete(reviewer);
		latest.set(reviewer, {
			reviewer,
			state: lower(row.state),
			current: commit === head,
			commit,
			submittedAt: string(row.submittedAt),
			url: string(row.url),
		});
	}

	const threads = threadNodes
		.filter((row) => row.isResolved !== true)
		.map((row): Thread => {
			const comment = array(object(row.comments).nodes).at(-1);
			const line = row.line ?? row.originalLine;
			return {
				id: string(row.id),
				path: string(row.path),
				line: typeof line === "number" ? line : null,
				outdated: row.isOutdated === true,
				lastAuthor: comment === undefined ? "-" : actor(comment.author),
				url: comment === undefined ? url : string(comment.url),
			};
		});

	const autoMerge = pull.autoMergeRequest === null ? null : object(pull.autoMergeRequest);
	const queue = pull.mergeQueueEntry === null ? null : object(pull.mergeQueueEntry);
	return {
		url,
		state: lower(pull.state) as Status["state"],
		draft: pull.isDraft === true,
		head,
		mergeable: lower(pull.mergeable),
		mergeState: lower(pull.mergeStateStatus),
		reviewDecision: pull.reviewDecision === null ? null : lower(pull.reviewDecision),
		autoMerge:
			autoMerge === null
				? null
				: {
						method: lower(autoMerge.mergeMethod),
						enabledBy: actor(autoMerge.enabledBy),
						enabledAt: string(autoMerge.enabledAt),
					},
		mergeQueue:
			queue === null
				? null
				: { state: lower(queue.state), position: Number(queue.position), enqueuedAt: string(queue.enqueuedAt) },
		checks,
		reviews: [...latest.values()],
		reactions,
		threads,
	};
}

/** Stable plain lines: a record type, then space-separated fields, with any free text last. */
export function statusLines(status: Status): string[] {
	const dash = (value: string | number | null) => (value === null ? "-" : String(value));
	const check = (kind: string, c: Check) =>
		`check ${kind} ${c.required ? "required" : "optional"} ${c.result} ${dash(c.url)} ${c.name}`;
	return [
		`url ${status.url}`,
		`state ${status.state}`,
		`draft ${status.draft}`,
		`head ${status.head}`,
		`mergeable ${status.mergeable}`,
		`merge-state ${status.mergeState}`,
		`review-decision ${dash(status.reviewDecision)}`,
		status.autoMerge === null
			? "auto-merge -"
			: `auto-merge ${status.autoMerge.method} ${status.autoMerge.enabledBy} ${status.autoMerge.enabledAt}`,
		status.mergeQueue === null
			? "merge-queue -"
			: `merge-queue ${status.mergeQueue.state} ${status.mergeQueue.position} ${status.mergeQueue.enqueuedAt}`,
		`checks ${dash(status.checks.state)} passed=${status.checks.passed} failing=${status.checks.failing.length} pending=${status.checks.pending.length}`,
		...status.checks.failing.map((c) => check("failing", c)),
		...status.checks.pending.map((c) => check("pending", c)),
		...status.reviews.map(
			(r) => `review ${r.current ? "current" : "stale"} ${r.state} ${r.reviewer} ${r.submittedAt} ${r.url}`,
		),
		...status.reactions.map((r) => `reacted:${r.content} ${r.actor} ${r.createdAt} ${r.url}`),
		...status.threads.map(
			(t) =>
				`thread ${t.id} ${t.outdated ? "outdated" : "current"} ${t.lastAuthor} ${t.url} ${t.path}:${dash(t.line)}`,
		),
	];
}

function lower(value: unknown): string {
	return string(value).toLowerCase();
}

function optional(value: unknown): string | null {
	return value === null || value === undefined || value === "" ? null : string(value);
}
