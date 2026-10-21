// GitHub-specific PR activity waiting stays outside the repository-independent core.
import {
	type GitHubDependencies,
	type ObjectValue,
	GitHub,
	array,
	githubRepository,
	link,
	object,
	remoteUrl,
	seconds,
	string,
} from "./github";

const POLL = 5 * 60_000;
const SHA = /^[a-f\d]{7,40}$/i;
/** The timeline records a force push a few seconds after repository activity (1-2s observed). */
const TIMELINE_LAG = 60_000;
/** Reactions on the PR body and on each review; the newest 100 per subject are enough to spot new ones. */
const REACTIONS = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
	viewer { login }
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			reactions(last: 100) { nodes { ...reaction } }
			reviews(first: 100, after: $after) {
				pageInfo { hasNextPage endCursor }
				nodes { url reactions(last: 100) { nodes { ...reaction } } }
			}
		}
	}
}
fragment reaction on Reaction { id content createdAt user { login } }`;

export interface PullRequest {
	owner: string;
	repo: string;
	number: number;
}

export interface WaitOptions {
	since?: string;
	/** Seconds; omitted means no deadline. */
	timeout?: number;
}

export type WaitDependencies = GitHubDependencies;

export class WaitInputError extends Error {}

export class WaitTimeout extends Error {
	/** Where to resume, when the wait got far enough to know. */
	constructor(readonly cursor?: string) {
		super("timed out waiting for pull request activity");
	}
}

interface Activity {
	point: string;
	time: number;
	type: string;
	actor: string;
	url: string;
	id: string;
}

/** Each source is read separately, so each keeps its own position. */
type Source = "timeline" | "replies" | "reactions";
const SOURCES: Source[] = ["timeline", "replies", "reactions"];
/** The newest event time read from a source, and the IDs of events at that time. */
interface Mark {
	time: number;
	ids: string[];
}

/** A cursor is a snapshot, since git timestamps cannot describe push order. */
interface Cursor {
	pr: string;
	marks: Record<Source, Mark>;
	commits: string[];
	/** Force pushes at or before the starting point, at their repository-activity time. */
	pushes: { sha: string; time: number }[];
}

/** Accept a GitHub PR URL, or a number in the origin repository. */
export function pullRequest(value: string, root: string): PullRequest {
	if (/^[1-9]\d*$/.test(value)) {
		const repository = githubRepository(remoteUrl(root, "origin"));
		if (!repository) throw new Error("origin must name a github.com repository; pass a GitHub PR URL instead");
		return { ...repository, number: Number(value) };
	}
	const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/.exec(value);
	if (!match) throw new WaitInputError("expected a GitHub pull request URL or a PR number in origin");
	return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** Wait until activity, returning plain output lines. Network and time are injected. */
export async function waitForActivity(
	pr: PullRequest,
	options: WaitOptions,
	deps: WaitDependencies,
): Promise<string[]> {
	const started = deps.now();
	const progress = { resume: options.since };
	try {
		return await watch(pr, options, deps, started, progress);
	} catch (error) {
		// This also covers a deadline expiring while a response body is read.
		if (options.timeout !== undefined && deps.now() - started >= options.timeout * 1000)
			throw new WaitTimeout(progress.resume);
		throw error;
	}
}

async function watch(
	pr: PullRequest,
	options: WaitOptions,
	deps: WaitDependencies,
	started: number,
	progress: { resume?: string },
): Promise<string[]> {
	if (options.since && !options.since.startsWith("q1.") && !SHA.test(options.since)) {
		try {
			timestamp(options.since);
		} catch (error) {
			throw new WaitInputError((error as Error).message);
		}
	}
	const name = `${pr.owner}/${pr.repo}#${pr.number}`;
	const base = `/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}`;
	const prUrl = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
	const deadline = options.timeout === undefined ? Infinity : started + options.timeout * 1000;
	const pause = async (milliseconds: number) => {
		const remaining = deadline - deps.now();
		if (remaining <= 0) throw new WaitTimeout();
		await deps.sleep(Math.min(milliseconds, remaining, 2_147_483_647));
		if (deps.now() >= deadline) throw new WaitTimeout();
	};
	let pollInterval = POLL;
	// Any failure past the deadline, the client's included, becomes a WaitTimeout in waitForActivity.
	const github = new GitHub(
		{
			...deps,
			fetch: async (url, init) => {
				const response = await deps.fetch(url, init);
				pollInterval = Math.max(pollInterval, seconds(response.headers.get("x-poll-interval")) ?? 0);
				return response;
			},
		},
		deadline,
	);
	const request = (path: string, etag?: string, body?: unknown) => github.request(path, { etag, body });
	const list = (path: string) => github.list(path);

	let cursor: Cursor;
	let historical: Activity[] = [];
	const baselineCommits = new Set<string>();
	let pushedTips: string[] = [];
	if (options.since?.startsWith("q1.")) {
		cursor = decodeCursor(options.since, name);
	} else {
		const pullResponse = await request(`${base}/pulls/${pr.number}`);
		const pull = object(await pullResponse.json());
		const head = object(pull.head);
		const currentSha = string(head.sha);
		// Until setup finishes, a timeout resumes from this head rather than whatever is pushed next.
		progress.resume = options.since ?? currentSha;
		// Verify the listing belongs to this exact head before treating it as
		// baseline membership. A racing push must never be silently swallowed.
		let commitsPath: string | undefined = `${base}/pulls/${pr.number}/commits?per_page=100`;
		let listedHead: string | undefined;
		while (commitsPath) {
			const { rows, response } = await list(commitsPath);
			for (const commit of rows) {
				listedHead = string(commit.sha);
				if (!fullSha(listedHead)) throw new Error("invalid GitHub commit SHA");
				baselineCommits.add(listedHead);
			}
			commitsPath = link(response, "next");
		}
		if (listedHead !== currentSha) {
			throw new Error(
				"cannot snapshot PR commits: head changed during setup, or GitHub's 250-commit listing limit was reached; rerun after checking the PR head",
			);
		}
		const point = options.since ?? currentSha;
		const shaPoint = SHA.test(point);
		const time = shaPoint ? undefined : timestamp(point);
		const activities: ObjectValue[] = [];
		if (head.repo !== null) {
			const headRepo = object(head.repo);
			const fullName = string(headRepo.full_name);
			if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error("invalid GitHub head repository");
			let path: string | undefined =
				`/repos/${fullName}/activity?ref=${encodeURIComponent(string(head.ref))}&per_page=100`;
			while (path) {
				const { rows, response } = await list(path);
				activities.push(...rows);
				if (
					shaPoint
						? rows.some((row) => string(row.after).startsWith(point.toLowerCase()))
						: rows.some((row) => timestamp(string(row.timestamp)) <= time!)
				)
					break;
				path = link(response, "next");
			}
		} else if (shaPoint) {
			throw new Error("head repository was deleted; pass a timestamp with --since");
		}
		const pushed = activities.filter((row) =>
			["push", "force_push", "branch_creation"].includes(string(row.activity_type)),
		);
		const match = shaPoint ? pushed.find((row) => string(row.after).startsWith(point.toLowerCase())) : undefined;
		if (shaPoint && !match) throw new Error(`cannot resolve push time for ${point}; pass a timestamp with --since`);
		const since = time ?? timestamp(string(match!.timestamp));
		// An explicit timestamp includes its own instant; a SHA point excludes its own push.
		const after = (row: ObjectValue) => {
			const pushedAt = timestamp(string(row.timestamp));
			return shaPoint ? pushedAt > since : pushedAt >= since;
		};
		// Force pushes are reported from the timeline alone, so one push prints once.
		const forced = pushed.filter((row) => string(row.activity_type) === "force_push");
		cursor = {
			pr: name,
			marks: {
				timeline: { time: since, ids: [] },
				replies: { time: since, ids: [] },
				reactions: { time: since, ids: [] },
			},
			commits: [],
			pushes: forced
				.filter((row) => !after(row))
				.map((row) => ({ sha: string(row.after), time: timestamp(string(row.timestamp)) })),
		};
		const plain = pushed.filter((row) => string(row.activity_type) !== "force_push" && after(row));
		// A push racing setup is reported once, as a push, not again as a new commit.
		pushedTips = plain.map((row) => string(row.after));
		for (const sha of pushedTips) baselineCommits.add(sha);
		historical = plain.map((row) => ({
			point: string(row.timestamp),
			time: timestamp(string(row.timestamp)),
			type: "pushed",
			actor: actor(row.actor),
			url: `https://github.com/${string(object(head.repo).full_name)}/commit/${string(row.after)}`,
			id: `push:${string(row.after)}:${string(row.timestamp)}`,
		}));
	}

	const seenCommits = new Set([...baselineCommits, ...cursor.commits]);
	// Activity found before a timeout is not printed, so resuming must find it again;
	// a push found during setup comes back as its new commit.
	progress.resume = encodeCursor({
		...cursor,
		commits: [...seenCommits].filter((sha) => !pushedTips.includes(sha)),
	});
	const seen = Object.fromEntries(SOURCES.map((source) => [source, new Set(cursor.marks[source].ids)])) as Record<
		Source,
		Set<string>
	>;
	const fresh = (source: Source, event: Activity) => {
		const mark = cursor.marks[source];
		return event.time > mark.time || (event.time === mark.time && !seen[source].has(event.id));
	};
	/** Read every page once, then poll the last page conditionally, following it when it fills. */
	const pager = (first: string) => {
		let path = first;
		let etag: string | undefined;
		return async (): Promise<ObjectValue[]> => {
			const rows: ObjectValue[] = [];
			for (;;) {
				const response = await request(path, etag);
				if (response.status === 304) {
					if (!etag) throw new Error("unexpected GitHub 304 without a cached response");
					return rows;
				}
				rows.push(...array(await response.json()));
				const next = link(response, "next");
				if (!next) {
					etag = response.headers.get("etag") ?? undefined;
					return rows;
				}
				path = next;
				etag = undefined;
			}
		};
	};
	/** REST has no endpoint for reactions on reviews, and GraphQL also names the waiter. */
	const reactions = async (): Promise<{ viewer: string; events: Activity[] }> => {
		const events: Activity[] = [];
		let viewer: string;
		let after: string | null = null;
		do {
			const response = await request("/graphql", undefined, {
				query: REACTIONS,
				variables: { owner: pr.owner, repo: pr.repo, number: pr.number, after },
			});
			const body = object(await response.json());
			if (body.errors !== undefined)
				throw new Error(
					`GitHub GraphQL error: ${array(body.errors)
						.map((error) => String(error.message))
						.join("; ")}`,
				);
			const data = object(body.data);
			viewer = string(object(data.viewer).login);
			const pull = object(object(data.repository).pullRequest);
			const reviews = object(pull.reviews);
			const reacted = (owner: ObjectValue, url: string) =>
				array(object(owner.reactions).nodes).map((row) => reaction(row, url));
			if (after === null) events.push(...reacted(pull, prUrl));
			for (const review of array(reviews.nodes)) events.push(...reacted(review, string(review.url)));
			const page = object(reviews.pageInfo);
			after = page.hasNextPage === true ? string(page.endCursor) : null;
		} while (after !== null);
		return { viewer, events };
	};

	const timeline = pager(`${base}/issues/${pr.number}/timeline?per_page=100`);
	// `since` excludes its own instant and filters by update time, which is never before
	// creation; start a second early so unseen replies at the mark's second are still read.
	const comments = pager(
		`${base}/pulls/${pr.number}/comments?per_page=100&since=${new Date(cursor.marks.replies.time - 1000).toISOString()}`,
	);
	const found: Record<Source, Activity[]> = { timeline: historical, replies: [], reactions: [] };
	for (;;) {
		pollInterval = POLL;
		for (const row of await timeline()) {
			const type = string(row.event);
			if (type === "committed") {
				const sha = string(row.sha);
				if (!fullSha(sha)) throw new Error("invalid GitHub committed SHA");
				if (!seenCommits.has(sha)) {
					found.timeline.push({
						point: sha,
						time: cursor.marks.timeline.time,
						type: "committed",
						actor: actor(row.actor ?? row.committer),
						url: string(row.html_url),
						id: `commit:${sha}`,
					});
				}
				seenCommits.add(sha);
				continue;
			}
			for (const event of timelineActivities(row, prUrl)) {
				if (
					type === "head_ref_force_pushed" &&
					cursor.pushes.some(
						(push) =>
							push.sha === row.commit_id &&
							event.time >= push.time &&
							event.time - push.time <= TIMELINE_LAG,
					)
				)
					continue;
				if (fresh("timeline", event)) found.timeline.push(event);
			}
		}
		const replies = await comments();
		const { viewer, events } = await reactions();
		// The waiter's own replies and reactions never wake it.
		for (const row of replies) {
			// A thread's first comment belongs to a review, which the timeline reports.
			if (row.in_reply_to_id === undefined || row.in_reply_to_id === null) continue;
			const event = timedActivity(row, "replied", "created_at", prUrl);
			if (event.actor !== viewer && fresh("replies", event)) found.replies.push(event);
		}
		found.reactions.push(...events.filter((event) => event.actor !== viewer && fresh("reactions", event)));

		if (SOURCES.some((source) => found[source].length)) {
			const marks = Object.fromEntries(
				SOURCES.map((source) => {
					const mark = cursor.marks[source];
					const time = Math.max(mark.time, ...found[source].map((event) => event.time));
					const ids = [
						...(time === mark.time ? mark.ids : []),
						...found[source].filter((event) => event.time === time).map((event) => event.id),
					];
					return [source, { time, ids: [...new Set(ids)] }];
				}),
			) as Record<Source, Mark>;
			const nextCursor = encodeCursor({
				pr: name,
				marks,
				commits: [...seenCommits],
				pushes: cursor.pushes.filter((push) => push.time + TIMELINE_LAG >= marks.timeline.time),
			});
			const all = SOURCES.flatMap((source) => found[source]).sort((a, b) => a.time - b.time);
			const unique = [...new Map(all.map((event) => [event.id, event])).values()];
			return unique.map(
				(event, index) =>
					`${event.point} ${event.type} ${event.actor} ${event.url}${index === unique.length - 1 ? ` ${nextCursor}` : ""}`,
			);
		}
		await pause(pollInterval);
	}
}

// A dequeue or a disabled auto-merge needs the agent. A merge also leaves the queue, a second before "merged".
const WAKES = [
	"reviewed",
	"commented",
	"merged",
	"closed",
	"head_ref_force_pushed",
	"removed_from_merge_queue",
	"auto_merge_disabled",
];

function timelineActivities(row: ObjectValue, prUrl: string): Activity[] {
	const type = string(row.event);
	if (type === "line-commented" || type === "commit-commented") {
		return array(row.comments).map((comment) => timedActivity(comment, type, "created_at", prUrl));
	}
	if (!WAKES.includes(type)) return [];
	return [timedActivity(row, type, type === "reviewed" ? "submitted_at" : "created_at", prUrl)];
}

function timedActivity(row: ObjectValue, type: string, timeField: string, fallback: string): Activity {
	const point = string(row[timeField]);
	const id = row.id;
	if (typeof id !== "number" && typeof id !== "string") throw new Error("missing GitHub event ID");
	return {
		point,
		time: timestamp(point),
		type,
		actor: actor(row.actor ?? row.user),
		url: row.html_url === undefined ? fallback : string(row.html_url),
		id: `${type}:${id}`,
	};
}

function reaction(row: ObjectValue, url: string): Activity {
	const point = string(row.createdAt);
	return {
		point,
		time: timestamp(point),
		type: `reacted:${string(row.content).toLowerCase()}`,
		actor: actor(row.user),
		url,
		id: `reacted:${string(row.id)}`,
	};
}

function actor(value: unknown): string {
	if (value === null || value === undefined) return "-";
	const record = object(value);
	return typeof record.login === "string"
		? record.login
		: typeof record.name === "string"
			? record.name.replace(/\s/g, "_")
			: "-";
}

function timestamp(value: string): number {
	const result = Date.parse(value);
	if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(result))
		throw new Error(`invalid timestamp: ${value}; use an ISO 8601 timestamp, a pushed SHA, or a returned cursor`);
	return result;
}

function fullSha(value: unknown): boolean {
	return typeof value === "string" && /^[a-f\d]{40}$/i.test(value);
}

function encodeCursor(cursor: Cursor): string {
	return `q1.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

function decodeCursor(value: string, pr: string): Cursor {
	try {
		const parsed = object(JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8")));
		const marks = object(parsed.marks);
		if (
			parsed.pr !== pr ||
			!SOURCES.every((source) => {
				const mark = object(marks[source]);
				return (
					typeof mark.time === "number" &&
					Number.isFinite(mark.time) &&
					Array.isArray(mark.ids) &&
					mark.ids.every((id) => typeof id === "string")
				);
			}) ||
			!Array.isArray(parsed.commits) ||
			!parsed.commits.every(fullSha) ||
			!Array.isArray(parsed.pushes) ||
			!parsed.pushes.every((push: ObjectValue | null) => fullSha(push?.sha) && Number.isFinite(push?.time))
		)
			throw new Error();
		return parsed as unknown as Cursor;
	} catch {
		throw new WaitInputError("invalid --since cursor, or cursor belongs to another pull request");
	}
}
