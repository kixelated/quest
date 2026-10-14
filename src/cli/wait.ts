// GitHub-specific PR activity waiting stays outside the repository-independent core.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.github.com";
const POLL = 5 * 60_000;
const SHA = /^[a-f\d]{7,40}$/i;

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
	constructor() {
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

/** A cursor is a snapshot, since git timestamps cannot describe push order. */
interface Cursor {
	pr: string;
	time: number;
	ids: string[];
	commits: string[];
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
	try {
		return await watch(pr, options, deps, started);
	} catch (error) {
		// This also covers a deadline expiring while a response body is read.
		if (options.timeout !== undefined && deps.now() - started >= options.timeout * 1000) throw new WaitTimeout();
		throw error;
	}
}

async function watch(
	pr: PullRequest,
	options: WaitOptions,
	deps: WaitDependencies,
	started: number,
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
	const request = async (path: string, etag?: string): Promise<Response> => {
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
			pollInterval = Math.max(POLL, seconds(response.headers.get("x-poll-interval")) ?? 0);
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
	if (options.since?.startsWith("q1.")) {
		cursor = decodeCursor(options.since, name);
	} else {
		const pullResponse = await request(`${base}/pulls/${pr.number}`);
		const pull = object(await pullResponse.json());
		const head = object(pull.head);
		const currentSha = string(head.sha);
		// Verify the listing belongs to this exact head before treating it as
		// baseline membership. A racing push must never be silently swallowed.
		let commitsPath: string | undefined = `${base}/pulls/${pr.number}/commits?per_page=100`;
		let listedHead: string | undefined;
		while (commitsPath) {
			const { rows, response } = await list(commitsPath);
			for (const commit of rows) {
				listedHead = string(commit.sha);
				if (!/^[a-f\d]{40}$/i.test(listedHead)) throw new Error("invalid GitHub commit SHA");
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
		cursor = { pr: name, time: since, ids: [], commits: [] };
		historical = pushed
			.filter((row) => timestamp(string(row.timestamp)) > since)
			.map((row) => ({
				point: string(row.timestamp),
				time: timestamp(string(row.timestamp)),
				type: string(row.activity_type) === "force_push" ? "head_ref_force_pushed" : "pushed",
				actor: actor(row.actor),
				url: `https://github.com/${string(object(head.repo).full_name)}/commit/${string(row.after)}`,
				id: `push:${string(row.after)}:${string(row.timestamp)}`,
			}));
	}

	const seenCommits = new Set([...baselineCommits, ...cursor.commits]);
	const seenIds = new Set(cursor.ids);
	const timeline = `${base}/issues/${pr.number}/timeline?per_page=100`;
	let path = timeline;
	let etag: string | undefined;
	for (;;) {
		const response = await request(path, etag);
		if (response.status === 304) {
			if (!etag) throw new Error("unexpected GitHub 304 without a cached response");
			await pause(pollInterval);
			continue;
		}
		const rows = array(await response.json());
		const events: Activity[] = [];
		for (const row of rows) {
			const type = string(row.event);
			if (type === "committed") {
				const sha = string(row.sha);
				if (!/^[a-f\d]{40}$/i.test(sha)) throw new Error("invalid GitHub committed SHA");
				if (!seenCommits.has(sha)) {
					events.push({
						point: sha,
						time: cursor.time,
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
				if (event.time > cursor.time || (event.time === cursor.time && !seenIds.has(event.id)))
					events.push(event);
			}
		}
		// Drain pagination before returning so the cursor also records every commit.
		historical.push(...events);
		const next = link(response, "next");
		if (next) {
			path = next;
			etag = undefined;
			continue;
		}
		if (historical.length) {
			historical.sort((a, b) => a.time - b.time);
			const unique = [...new Map(historical.map((event) => [event.id, event])).values()];
			const latest = Math.max(cursor.time, ...unique.map((event) => event.time));
			const ids = [
				...(latest === cursor.time ? seenIds : []),
				...unique.filter((event) => event.time === latest).map((event) => event.id),
			];
			const nextCursor = encodeCursor({
				pr: name,
				time: latest,
				ids: [...new Set(ids)],
				commits: [...seenCommits],
			});
			return unique.map(
				(event, index) =>
					`${event.point} ${event.type} ${event.actor} ${event.url}${index === unique.length - 1 ? ` ${nextCursor}` : ""}`,
			);
		}
		etag = response.headers.get("etag") ?? undefined;
		await pause(pollInterval);
	}
}

function timelineActivities(row: ObjectValue, prUrl: string): Activity[] {
	const type = string(row.event);
	if (type === "line-commented" || type === "commit-commented") {
		return array(row.comments).map((comment) => timedActivity(comment, type, "created_at", prUrl));
	}
	if (!["reviewed", "commented", "merged", "closed", "head_ref_force_pushed"].includes(type)) return [];
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

function encodeCursor(cursor: Cursor): string {
	return `q1.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

function decodeCursor(value: string, pr: string): Cursor {
	try {
		const parsed = object(JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8")));
		if (
			parsed.pr !== pr ||
			typeof parsed.time !== "number" ||
			!Number.isFinite(parsed.time) ||
			!Array.isArray(parsed.ids) ||
			!parsed.ids.every((id) => typeof id === "string") ||
			!Array.isArray(parsed.commits) ||
			!parsed.commits.every((sha) => typeof sha === "string" && /^[a-f\d]{40}$/i.test(sha))
		)
			throw new Error();
		return parsed as unknown as Cursor;
	} catch {
		throw new WaitInputError("invalid --since cursor, or cursor belongs to another pull request");
	}
}
