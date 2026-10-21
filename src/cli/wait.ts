// GitHub-specific PR activity waiting stays outside the repository-independent core.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.github.com";
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
/** The head's check runs and commit statuses, with whether the base branch requires each. */
const CHECKS = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			baseRefName
			headRefOid
			commits(last: 1) { nodes { commit { oid statusCheckRollup {
				contexts(first: 100, after: $after) {
					pageInfo { hasNextPage endCursor }
					nodes {
						__typename
						... on CheckRun { name status conclusion completedAt detailsUrl isRequired(pullRequestNumber: $number) }
						... on StatusContext { context state createdAt targetUrl isRequired(pullRequestNumber: $number) }
					}
				}
			} } } }
		}
	}
}`;
/** Branch protection and rulesets treat these as passing. */
const PASSING = ["SUCCESS", "NEUTRAL", "SKIPPED"];

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

export interface WaitDependencies {
	fetch: typeof fetch;
	now(): number;
	sleep(milliseconds: number): Promise<unknown>;
	token: string;
	warn(message: string): void;
}

export class WaitInputError extends Error {}

export class WaitTimeout extends Error {
	/** Where to resume, when the wait got far enough to know. */
	constructor(readonly cursor?: string) {
		super("timed out waiting for pull request activity");
	}
}

type ObjectValue = Record<string, unknown>;
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
	/** Check results reached at or after `since` are reported once per head, as `<sha>:<outcome>`. */
	checks: { since: number; reported: string[] };
}

/** One check run or commit status on the head, with its result once it has one. */
interface Check {
	name: string;
	required: boolean;
	url?: string;
	result?: { outcome: "passed" | "failed"; point: string; time: number };
}

/** Accept a GitHub PR URL, or a number in the origin repository. */
export function pullRequest(value: string, root: string): PullRequest {
	if (/^[1-9]\d*$/.test(value)) {
		const origin = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		const match =
			/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
				origin,
			);
		if (!match) throw new Error("origin must name a github.com repository; pass a GitHub PR URL instead");
		return { owner: match[1], repo: match[2], number: Number(value) };
	}
	const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/.exec(value);
	if (!match) throw new WaitInputError("expected a GitHub pull request URL or a PR number in origin");
	return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function waitDependencies(): WaitDependencies {
	let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	if (!token) {
		try {
			token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		} catch {
			throw new Error("set GH_TOKEN or GITHUB_TOKEN, or sign in with gh auth login");
		}
	}
	if (!token) throw new Error("GitHub authentication returned an empty token");
	return { fetch, now: Date.now, sleep, token, warn: (message) => process.stderr.write(`quest: ${message}\n`) };
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
	const request = async (path: string, etag?: string, payload?: unknown): Promise<Response> => {
		// Follow only same-origin pagination links; never send a token to another host.
		const url = new URL(path, API);
		if (url.origin !== API || url.username || url.password) throw new Error("invalid GitHub pagination URL");
		let attempts = 0;
		for (;;) {
			const remaining = deadline - deps.now();
			if (remaining <= 0) throw new WaitTimeout();
			let response: Response;
			try {
				response = await deps.fetch(url, {
					...(payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }),
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${deps.token}`,
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "quest",
						...(etag ? { "If-None-Match": etag } : {}),
					},
					...(Number.isFinite(remaining) ? { signal: AbortSignal.timeout(Math.ceil(remaining)) } : {}),
				});
			} catch (error) {
				if (deps.now() >= deadline) throw new WaitTimeout();
				throw error;
			}
			pollInterval = Math.max(pollInterval, seconds(response.headers.get("x-poll-interval")) ?? 0);
			if (response.status === 200 || response.status === 304) return response;
			const body = await response.text();
			const limited =
				response.status === 429 ||
				(response.status === 403 &&
					(response.headers.has("retry-after") ||
						response.headers.get("x-ratelimit-remaining") === "0" ||
						/rate limit/i.test(body)));
			if (!limited || attempts >= 6)
				throw new Error(
					`GitHub HTTP ${response.status} for ${url.pathname}; ${limited ? "rate limit persisted" : "check repository access and token permissions"}`,
				);
			const retry = seconds(response.headers.get("retry-after"));
			const reset =
				response.headers.get("x-ratelimit-remaining") === "0"
					? seconds(response.headers.get("x-ratelimit-reset"))
					: undefined;
			const delay = retry ?? (reset === undefined ? 60_000 * 2 ** attempts : Math.max(1000, reset - deps.now()));
			attempts++;
			deps.warn(`GitHub rate limited this request; waiting ${Math.ceil(delay / 1000)} seconds`);
			await pause(delay);
		}
	};
	const list = async (path: string): Promise<{ rows: ObjectValue[]; response: Response }> => {
		const response = await request(path);
		if (response.status !== 200) throw new Error("unexpected GitHub 304 without a cached response");
		return { rows: array(await response.json()), response };
	};

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
			checks: { since, reported: [] },
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
	const graphql = async (query: string, after: string | null): Promise<ObjectValue> => {
		const response = await request("/graphql", undefined, {
			query,
			variables: { owner: pr.owner, repo: pr.repo, number: pr.number, after },
		});
		const body = object(await response.json());
		if (body.errors !== undefined)
			throw new Error(
				`GitHub GraphQL error: ${array(body.errors)
					.map((error) => String(error.message))
					.join("; ")}`,
			);
		return object(body.data);
	};
	/** REST has no endpoint for reactions on reviews, and GraphQL also names the waiter. */
	const reactions = async (): Promise<{ viewer: string; events: Activity[] }> => {
		const events: Activity[] = [];
		let viewer: string;
		let after: string | null = null;
		do {
			const data = await graphql(REACTIONS, after);
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
	/** GraphQL says which checks the base branch requires, through branch protection or rulesets. */
	const checks = async (): Promise<{ head: string; base: string; checks: Check[] } | undefined> => {
		const result: Check[] = [];
		let head: string | undefined;
		let after: string | null = null;
		let pull: ObjectValue;
		do {
			pull = object(object((await graphql(CHECKS, after)).repository).pullRequest);
			const commit = object(array(object(pull.commits).nodes)[0]?.commit);
			// A push racing these pages is read whole on the next poll.
			if (commit.oid !== pull.headRefOid || (head !== undefined && commit.oid !== head)) return undefined;
			head = string(commit.oid);
			if (!fullSha(head)) throw new Error("invalid GitHub head SHA");
			if (commit.statusCheckRollup === null) break;
			const contexts = object(object(commit.statusCheckRollup).contexts);
			result.push(...array(contexts.nodes).map(check));
			const page = object(contexts.pageInfo);
			after = page.hasNextPage === true ? string(page.endCursor) : null;
		} while (after !== null);
		return { head: head!, base: string(pull.baseRefName), checks: result };
	};
	/**
	 * The check names the base branch requires, read once per wait. Only a requirement says whether a
	 * missing check has yet to start, or whether the repository requires none.
	 */
	const requirements = new Map<string, Set<string>>();
	const required = async (branch: string): Promise<Set<string>> => {
		const known = requirements.get(branch);
		if (known) return known;
		const path = `${base}/branches/${encodeURIComponent(branch)}`;
		const protection = object(object(await (await request(path)).json()).protection ?? {});
		const legacy = object(protection.required_status_checks ?? { checks: [] });
		const rules = array(await (await request(`${base}/rules/branches/${encodeURIComponent(branch)}`)).json());
		const names = new Set([
			...(legacy.enforcement_level === "off" ? [] : array(legacy.checks).map((row) => string(row.context))),
			...rules
				.filter((rule) => rule.type === "required_status_checks")
				.flatMap((rule) => array(object(rule.parameters).required_status_checks))
				.map((row) => string(row.context)),
		]);
		requirements.set(branch, names);
		return names;
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
		// Check results are state rather than a log, so each poll reads them afresh.
		const head = await checks();
		const reached = head
			? checkActivities(head.head, head.checks, await required(head.base), cursor.checks, prUrl)
			: [];

		if (reached.length || SOURCES.some((source) => found[source].length)) {
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
				checks: {
					since: cursor.checks.since,
					// A new head starts over, so only the current head's reports are kept.
					reported: [
						...cursor.checks.reported.filter((id) => !head || id.startsWith(`${head.head}:`)),
						...reached.map((event) => event.id),
					],
				},
			});
			const all = [...SOURCES.flatMap((source) => found[source]), ...reached].sort((a, b) => a.time - b.time);
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

/** A check run or commit status; neutral and skipped results pass, as branch protection treats them. */
function check(row: ObjectValue): Check {
	const run = row.__typename === "CheckRun";
	if (!run && row.__typename !== "StatusContext") throw new Error("invalid GitHub check");
	const link = run ? row.detailsUrl : row.targetUrl;
	const found: Check = {
		name: string(run ? row.name : row.context),
		required: row.isRequired === true,
		url: typeof link === "string" ? link : undefined,
	};
	const state = run ? (row.status === "COMPLETED" ? string(row.conclusion) : undefined) : string(row.state);
	if (state === undefined || state === "PENDING" || state === "EXPECTED") return found;
	const point = string(run ? row.completedAt : row.createdAt);
	found.result = { outcome: PASSING.includes(state) ? "passed" : "failed", point, time: timestamp(point) };
	return found;
}

/**
 * The head's first required failure, and every required check passing, each reported once per head
 * when reached at or after the starting point. A base branch that requires no checks requires them all.
 */
function checkActivities(
	head: string,
	all: Check[],
	names: Set<string>,
	state: Cursor["checks"],
	prUrl: string,
): Activity[] {
	const required = names.size ? all.filter((entry) => entry.required) : all;
	// GitHub lists a check only once it starts, so a required one created late is still to come.
	const started = [...names].every((name) => all.some((entry) => entry.name === name));
	const reached = (outcome: "passed" | "failed", entry: Check | undefined): Activity[] => {
		const id = `${head}:${outcome}`;
		if (!entry?.result || entry.result.time < state.since || state.reported.includes(id)) return [];
		return [
			{
				point: entry.result.point,
				time: entry.result.time,
				type: `checks:${outcome}`,
				actor: entry.name.replace(/\s/g, "_"),
				url: entry.url ?? `${prUrl}/checks`,
				id,
			},
		];
	};
	const settled = required.flatMap((entry) => (entry.result ? [{ ...entry, result: entry.result }] : []));
	settled.sort((a, b) => a.result.time - b.result.time);
	const failed = settled.find((entry) => entry.result.outcome === "failed" && entry.result.time >= state.since);
	const passed =
		started && settled.length === required.length && settled.every((entry) => entry.result.outcome === "passed")
			? settled.at(-1)
			: undefined;
	return [...reached("failed", failed), ...reached("passed", passed)];
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

function object(value: unknown): ObjectValue {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("invalid GitHub response: expected an object");
	return value as ObjectValue;
}

function array(value: unknown): ObjectValue[] {
	if (!Array.isArray(value)) throw new Error("invalid GitHub response: expected an array");
	return value.map(object);
}

function string(value: unknown): string {
	if (typeof value !== "string" || !value) throw new Error("invalid GitHub response: expected a nonempty string");
	return value;
}

function timestamp(value: string): number {
	const result = Date.parse(value);
	if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(result))
		throw new Error(`invalid timestamp: ${value}; use an ISO 8601 timestamp, a pushed SHA, or a returned cursor`);
	return result;
}

function seconds(value: string | null): number | undefined {
	if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
	const result = Number(value) * 1000;
	return Number.isFinite(result) ? result : undefined;
}

function link(response: Response, relation: string): string | undefined {
	return response.headers
		.get("link")
		?.split(",")
		.map((entry) => /<([^>]+)>;\s*rel="([^"]+)"/.exec(entry.trim()))
		.find((match) => match?.[2] === relation)?.[1];
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
		const checks = object(parsed.checks);
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
			!parsed.pushes.every((push: ObjectValue | null) => fullSha(push?.sha) && Number.isFinite(push?.time)) ||
			!Number.isFinite(checks.since) ||
			!Array.isArray(checks.reported) ||
			!checks.reported.every((id) => typeof id === "string")
		)
			throw new Error();
		return parsed as unknown as Cursor;
	} catch {
		throw new WaitInputError("invalid --since cursor, or cursor belongs to another pull request");
	}
}
