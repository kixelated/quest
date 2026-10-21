// The GitHub client shared by the PR commands, outside the repository-independent core.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.github.com";
const MAX_SLEEP = 2_147_483_647;

export interface PullRequest {
	owner: string;
	repo: string;
	number: number;
}

export interface GitHubDependencies {
	fetch: typeof fetch;
	now(): number;
	sleep(milliseconds: number): Promise<unknown>;
	token: string;
	warn(message: string): void;
}

/** A bad PR argument or option, reported as a usage error. */
export class GitHubInputError extends Error {}

/** A request or pause reached the client's deadline; the caller decides what that means. */
export class GitHubDeadline extends Error {
	constructor() {
		super("deadline reached");
	}
}

export type ObjectValue = Record<string, unknown>;

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
	if (!match) throw new GitHubInputError("expected a GitHub pull request URL or a PR number in origin");
	return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function gitHubDependencies(warn: (message: string) => void): GitHubDependencies {
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
	return { fetch, now: Date.now, sleep, token, warn };
}

/** Authenticated REST and GraphQL requests that wait out rate limits, bounded by an optional deadline. */
export class GitHub {
	/** The longest X-Poll-Interval GitHub asked for since the caller last set this, in milliseconds. */
	pollInterval = 0;

	constructor(
		private readonly deps: GitHubDependencies,
		private readonly deadline = Infinity,
	) {}

	/** Sleep, cut short by the deadline. */
	async pause(milliseconds: number): Promise<void> {
		const remaining = this.deadline - this.deps.now();
		if (remaining <= 0) throw new GitHubDeadline();
		await this.deps.sleep(Math.min(milliseconds, remaining, MAX_SLEEP));
		if (this.deps.now() >= this.deadline) throw new GitHubDeadline();
	}

	/** A 200 or 304 response; anything else fails after rate-limit retries. */
	async request(path: string, etag?: string, payload?: unknown): Promise<Response> {
		// Follow only same-origin pagination links; never send a token to another host.
		const url = new URL(path, API);
		if (url.origin !== API || url.username || url.password) throw new Error("invalid GitHub pagination URL");
		let attempts = 0;
		for (;;) {
			const remaining = this.deadline - this.deps.now();
			if (remaining <= 0) throw new GitHubDeadline();
			let response: Response;
			try {
				response = await this.deps.fetch(url, {
					...(payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }),
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${this.deps.token}`,
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "quest",
						...(etag ? { "If-None-Match": etag } : {}),
					},
					...(Number.isFinite(remaining) ? { signal: AbortSignal.timeout(Math.ceil(remaining)) } : {}),
				});
			} catch (error) {
				if (this.deps.now() >= this.deadline) throw new GitHubDeadline();
				throw error;
			}
			this.pollInterval = Math.max(this.pollInterval, seconds(response.headers.get("x-poll-interval")) ?? 0);
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
			const delay =
				retry ?? (reset === undefined ? 60_000 * 2 ** attempts : Math.max(1000, reset - this.deps.now()));
			attempts++;
			this.deps.warn(`GitHub rate limited this request; waiting ${Math.ceil(delay / 1000)} seconds`);
			await this.pause(delay);
		}
	}

	/** Run a GraphQL query and return its data, failing on any reported error. */
	async graphql(query: string, variables: ObjectValue): Promise<ObjectValue> {
		const response = await this.request("/graphql", undefined, { query, variables });
		const body = object(await response.json());
		if (body.errors !== undefined)
			throw new Error(
				`GitHub GraphQL error: ${array(body.errors)
					.map((error) => String(error.message))
					.join("; ")}`,
			);
		return object(body.data);
	}
}

/** A login, a committer name without spaces, or `-` for a deleted account. */
export function actor(value: unknown): string {
	if (value === null || value === undefined) return "-";
	const record = object(value);
	return typeof record.login === "string"
		? record.login
		: typeof record.name === "string"
			? record.name.replace(/\s/g, "_")
			: "-";
}

export function object(value: unknown): ObjectValue {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("invalid GitHub response: expected an object");
	return value as ObjectValue;
}

export function array(value: unknown): ObjectValue[] {
	if (!Array.isArray(value)) throw new Error("invalid GitHub response: expected an array");
	return value.map(object);
}

export function string(value: unknown): string {
	if (typeof value !== "string" || !value) throw new Error("invalid GitHub response: expected a nonempty string");
	return value;
}

export function link(response: Response, relation: string): string | undefined {
	return response.headers
		.get("link")
		?.split(",")
		.map((entry) => /<([^>]+)>;\s*rel="([^"]+)"/.exec(entry.trim()))
		.find((match) => match?.[2] === relation)?.[1];
}

function seconds(value: string | null): number | undefined {
	if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
	const result = Number(value) * 1000;
	return Number.isFinite(result) ? result : undefined;
}
