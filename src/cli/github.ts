// GitHub requests for the commands that talk to GitHub, outside the
// forge-agnostic core: authentication, rate-limit retry, and same-origin
// pagination.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.github.com";

export type ObjectValue = Record<string, unknown>;

/** Network, time, and credentials, injected so tests replay GitHub. */
export interface GitHubDependencies {
	fetch(url: URL, init: RequestInit): Promise<Response>;
	now(): number;
	sleep(milliseconds: number): Promise<unknown>;
	token: string;
	warn(message: string): void;
}

/** A repository on github.com. */
export interface Repository {
	owner: string;
	repo: string;
}

/** The request outlived the caller's deadline. */
export class GitHubDeadline extends Error {
	constructor() {
		super("deadline passed during a GitHub request");
	}
}

/** Authenticate with GH_TOKEN, then GITHUB_TOKEN, then `gh auth token`. */
export function githubDependencies(): GitHubDependencies {
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

/** The URL a git remote fetches from. */
export function remoteUrl(root: string, remote: string): string {
	return execFileSync("git", ["-C", root, "remote", "get-url", remote], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/** The github.com repository a remote URL names, or `null` for any other host. */
export function githubRepository(url: string): Repository | null {
	const match =
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	return match ? { owner: match[1], repo: match[2] } : null;
}

/** REST and GraphQL requests that retry rate limits and give up at `deadline` (epoch milliseconds). */
export class GitHub {
	constructor(
		private readonly deps: GitHubDependencies,
		private readonly deadline = Infinity,
	) {}

	/** One request, returning a success or 304; `body` makes it a POST unless `method` says otherwise. */
	async request(
		path: string,
		options: { etag?: string; body?: unknown; method?: "POST" | "PATCH" } = {},
	): Promise<Response> {
		const { deps, deadline } = this;
		// Follow only same-origin pagination links; never send a token to another host.
		const url = new URL(path, API);
		if (url.origin !== API || url.username || url.password) throw new Error("invalid GitHub pagination URL");
		let attempts = 0;
		for (;;) {
			const remaining = deadline - deps.now();
			if (remaining <= 0) throw new GitHubDeadline();
			let response: Response;
			try {
				response = await deps.fetch(url, {
					...(options.body === undefined
						? {}
						: { method: options.method ?? "POST", body: JSON.stringify(options.body) }),
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${deps.token}`,
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "quest",
						...(options.etag ? { "If-None-Match": options.etag } : {}),
					},
					...(Number.isFinite(remaining) ? { signal: AbortSignal.timeout(Math.ceil(remaining)) } : {}),
				});
			} catch (error) {
				if (deps.now() >= deadline) throw new GitHubDeadline();
				throw error;
			}
			if (response.ok || response.status === 304) return response;
			const body = await response.text();
			const limited =
				response.status === 429 ||
				(response.status === 403 &&
					(response.headers.has("retry-after") ||
						response.headers.get("x-ratelimit-remaining") === "0" ||
						/rate limit/i.test(body)));
			if (!limited || attempts >= 6)
				throw new Error(
					`GitHub HTTP ${response.status} for ${url.pathname}; ${limited ? "rate limit persisted" : (explanation(body) ?? "check repository access and token permissions")}`,
				);
			const retry = seconds(response.headers.get("retry-after"));
			const reset =
				response.headers.get("x-ratelimit-remaining") === "0"
					? seconds(response.headers.get("x-ratelimit-reset"))
					: undefined;
			const delay = retry ?? (reset === undefined ? 60_000 * 2 ** attempts : Math.max(1000, reset - deps.now()));
			attempts++;
			deps.warn(`GitHub rate limited this request; waiting ${Math.ceil(delay / 1000)} seconds`);
			const left = deadline - deps.now();
			if (left <= 0) throw new GitHubDeadline();
			await deps.sleep(Math.min(delay, left, 2_147_483_647));
			if (deps.now() >= deadline) throw new GitHubDeadline();
		}
	}

	/** One page of a REST listing, and its response for the next link. */
	async list(path: string): Promise<{ rows: ObjectValue[]; response: Response }> {
		const response = await this.request(path);
		if (response.status !== 200) throw new Error("unexpected GitHub 304 without a cached response");
		return { rows: array(await response.json()), response };
	}

	/** Every page of a REST listing. */
	async all(path: string): Promise<ObjectValue[]> {
		const rows: ObjectValue[] = [];
		for (let next: string | undefined = path; next;) {
			const page = await this.list(next);
			rows.push(...page.rows);
			next = link(page.response, "next");
		}
		return rows;
	}
}

/** The URL of a `Link` header relation, such as the next page. */
export function link(response: Response, relation: string): string | undefined {
	return response.headers
		.get("link")
		?.split(",")
		.map((entry) => /<([^>]+)>;\s*rel="([^"]+)"/.exec(entry.trim()))
		.find((match) => match?.[2] === relation)?.[1];
}

/** GitHub's reason in an error body, such as why it refused to create a pull request. */
function explanation(body: string): string | undefined {
	try {
		const parsed = object(JSON.parse(body));
		const errors = Array.isArray(parsed.errors) ? (parsed.errors as unknown[]) : [];
		const parts = [parsed.message, ...errors.map((error) => (error as ObjectValue | null)?.message)];
		return parts.filter((part): part is string => typeof part === "string" && part !== "").join(": ") || undefined;
	} catch {
		return undefined;
	}
}

/** Milliseconds from a header holding seconds. */
export function seconds(value: string | null): number | undefined {
	if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
	const result = Number(value) * 1000;
	return Number.isFinite(result) ? result : undefined;
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
