import { createPrivateKey, sign } from "node:crypto";
import { positiveId } from "./webhook";

export interface GitHubRepository {
	owner: string;
	name: string;
	id: number;
}
type Permission = "metadata" | "contents" | "issues" | "pull_requests" | "checks" | "statuses";
type Permissions = Partial<Record<Permission, "read" | "write">>;
interface Installation {
	id: number;
	app_id: number;
	suspended_at: string | null;
	permissions: Permissions;
}
interface Repository {
	id: number;
	name: string;
	owner: { login: string };
	archived: boolean;
	disabled: boolean;
	fork: boolean;
	parent?: { id: number };
}
export class GitHubError extends Error {}
interface GitHubEnvironment {
	DB: D1Database;
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
	GITHUB_FORK_OWNER: string;
}

function name(value: string) {
	return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value);
}
function repositoryPath(repo: GitHubRepository) {
	if (!positiveId(repo.id) || !name(repo.owner) || !name(repo.name)) throw new GitHubError("Invalid repository");
	return `/repos/${repo.owner}/${repo.name}`;
}
function number(value: number) {
	if (!positiveId(value)) throw new GitHubError("Invalid issue or pull request number");
	return value;
}
function sha(value: string) {
	if (!/^[a-f0-9]{40}$/.test(value)) throw new GitHubError("An exact commit SHA is required");
	return value;
}
function branch(value: string) {
	if (!/^quest\/[a-zA-Z0-9_/-]+$/.test(value) || value.includes("//") || value.endsWith("/"))
		throw new GitHubError("A quest contribution branch is required");
	return value;
}

/** Server-only integration. Call with an authenticated local session's user ID
 * after the product has approved the particular operation. Never expose this
 * object, credentials, arbitrary API requests, or installation tokens to agents.
 */
export class GitHubService {
	#env: GitHubEnvironment;
	#fetch: typeof fetch;
	constructor(env: GitHubEnvironment, request: typeof fetch = fetch) {
		this.#env = env;
		this.#fetch = request;
	}

	#jwt() {
		if (!/^\d+$/.test(this.#env.GITHUB_APP_ID) || !this.#env.GITHUB_APP_PRIVATE_KEY)
			throw new GitHubError("GitHub App not configured");
		const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
		const now = Math.floor(Date.now() / 1000);
		const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: this.#env.GITHUB_APP_ID, iat: now - 60, exp: now + 540 })}`;
		return `${body}.${sign("RSA-SHA256", Buffer.from(body), createPrivateKey(this.#env.GITHUB_APP_PRIVATE_KEY)).toString("base64url")}`;
	}

	async #api<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
		const response = await this.#fetch(`https://api.github.com${path}`, {
			method,
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"User-Agent": "Quest-GitHub-App",
				"X-GitHub-Api-Version": "2026-03-10",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		// Never include provider response bodies, request headers, or secrets in errors.
		if (!response.ok) throw new GitHubError(`GitHub request failed (${response.status})`);
		return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
	}

	async #gate(id: number) {
		const state = await this.#env.DB.prepare("SELECT blocked FROM github_installations WHERE id=?")
			.bind(id)
			.first<{ blocked: number }>();
		if (state?.blocked) throw new GitHubError("GitHub installation revoked or suspended");
	}

	async #withRepository<T>(
		repo: GitHubRepository,
		permissions: Permissions,
		action: (token: string, current: Repository, installationId: number) => Promise<T>,
	) {
		const path = repositoryPath(repo);
		// Resolve the installation from the live repository; no browser-supplied
		// installation IDs and no cached permission grants.
		const installation = await this.#api<Installation>(this.#jwt(), `${path}/installation`);
		if (
			!positiveId(installation.id) ||
			String(installation.app_id) !== this.#env.GITHUB_APP_ID ||
			installation.suspended_at
		)
			throw new GitHubError("GitHub installation unavailable");
		await this.#gate(installation.id);
		const scope: Permissions = { metadata: "read", ...permissions };
		for (const [permission, level] of Object.entries(scope)) {
			const granted = installation.permissions[permission as Permission];
			if (!granted || (level === "write" && granted !== "write"))
				throw new GitHubError(`GitHub ${permission} permission required`);
		}
		const minted = await this.#api<{ token: string }>(
			this.#jwt(),
			`/app/installations/${installation.id}/access_tokens`,
			"POST",
			{ repository_ids: [repo.id], permissions: scope },
		);
		if (!minted.token) throw new GitHubError("Installation token unavailable");
		try {
			const current = await this.#api<Repository>(minted.token, path);
			if (
				current.id !== repo.id ||
				current.owner.login.toLowerCase() !== repo.owner.toLowerCase() ||
				current.name.toLowerCase() !== repo.name.toLowerCase() ||
				current.archived ||
				current.disabled
			)
				throw new GitHubError("Repository identity or availability changed");
			await this.#gate(installation.id);
			return await action(minted.token, current, installation.id);
		} finally {
			// Do not turn a completed mutation into a retryable error if cleanup
			// fails. GitHub also expires installation tokens after one hour.
			try {
				await this.#api(minted.token, "/installation/token", "DELETE");
			} catch {
				console.error({ event: "github_token_revocation_failed" });
			}
		}
	}

	async #maintainer(token: string, repo: GitHubRepository, userId: string) {
		const account = await this.#env.DB.prepare(
			"SELECT accountId FROM account WHERE userId=? AND providerId='github' LIMIT 1",
		)
			.bind(userId)
			.first<{ accountId: string }>();
		if (!account || !/^\d+$/.test(account.accountId)) throw new GitHubError("Linked GitHub identity required");
		const user = await this.#api<{ id: number; login: string }>(token, `/user/${account.accountId}`);
		if (String(user.id) !== account.accountId || !name(user.login))
			throw new GitHubError("GitHub identity changed");
		const permission = await this.#api<{ permission: string; role_name: string; user: { id: number } }>(
			token,
			`${repositoryPath(repo)}/collaborators/${user.login}/permission`,
		);
		// GitHub maps maintain to legacy permission=write. Do not accidentally
		// grant maintainer authority to ordinary writers or custom roles.
		if (
			String(permission.user.id) !== account.accountId ||
			(permission.permission !== "admin" && permission.role_name !== "maintain")
		)
			throw new GitHubError("Current GitHub maintainer authority required");
	}

	async #authorized<T>(
		repo: GitHubRepository,
		userId: string,
		permissions: Permissions,
		action: (token: string, current: Repository) => Promise<T>,
	) {
		return this.#withRepository(repo, permissions, async (token, current, installationId) => {
			await this.#maintainer(token, repo, userId);
			await this.#gate(installationId);
			return action(token, current);
		});
	}

	// Reads also require authority: installations may contain private repositories.
	readQuest(repo: GitHubRepository, userId: string, path: string, commit: string) {
		if (
			!/^quest\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.md$/.test(path) ||
			path.split("/").some((p) => p === "." || p === "..")
		)
			throw new GitHubError("Invalid quest path");
		return this.#authorized(repo, userId, { contents: "read" }, (token) =>
			this.#api(token, `${repositoryPath(repo)}/contents/${path}?ref=${sha(commit)}`),
		);
	}
	readIssue(repo: GitHubRepository, userId: string, issue: number) {
		return this.#authorized(repo, userId, { issues: "read" }, (token) =>
			this.#api(token, `${repositoryPath(repo)}/issues/${number(issue)}`),
		);
	}
	readPullRequest(repo: GitHubRepository, userId: string, pull: number) {
		return this.#authorized(repo, userId, { pull_requests: "read" }, (token) =>
			this.#api(token, `${repositoryPath(repo)}/pulls/${number(pull)}`),
		);
	}
	readChecks(repo: GitHubRepository, userId: string, commit: string, page = 1) {
		if (!positiveId(page)) throw new GitHubError("Invalid checks page");
		return this.#authorized(repo, userId, { checks: "read", statuses: "read" }, async (token) => ({
			checks: await this.#api(
				token,
				`${repositoryPath(repo)}/commits/${sha(commit)}/check-runs?per_page=100&page=${page}`,
			),
			status: await this.#api(
				token,
				`${repositoryPath(repo)}/commits/${sha(commit)}/status?per_page=100&page=${page}`,
			),
		}));
	}
	comment(repo: GitHubRepository, userId: string, issue: number, approvedBody: string) {
		if (!approvedBody.trim()) throw new GitHubError("Approved comment required");
		return this.#authorized(repo, userId, { issues: "write" }, (token) =>
			this.#api(token, `${repositoryPath(repo)}/issues/${number(issue)}/comments`, "POST", {
				body: approvedBody,
			}),
		);
	}

	async createPullRequest(
		upstream: GitHubRepository,
		userId: string,
		fork: GitHubRepository,
		input: { branch: string; base: string; title: string; body: string },
	) {
		this.#forkNamespace(fork);
		if (!input.title.trim() || !input.base) throw new GitHubError("Approved pull request required");
		return this.#authorized(upstream, userId, { pull_requests: "write" }, async (token) => {
			await this.#withRepository(fork, {}, async (_token, current) => {
				if (!current.fork || current.parent?.id !== upstream.id)
					throw new GitHubError("Contribution repository must fork this upstream");
			});
			return this.#api(token, `${repositoryPath(upstream)}/pulls`, "POST", {
				head: `${fork.owner}:${branch(input.branch)}`,
				head_repo: fork.name,
				base: input.base,
				title: input.title,
				body: input.body,
				draft: true,
			});
		});
	}

	#forkNamespace(fork: GitHubRepository) {
		if (!this.#env.GITHUB_FORK_OWNER || fork.owner.toLowerCase() !== this.#env.GITHUB_FORK_OWNER.toLowerCase())
			throw new GitHubError("Configured service fork namespace required");
	}

	publishQuest(
		upstream: GitHubRepository,
		userId: string,
		fork: GitHubRepository,
		input: { branch: string; path: string; content: string; message: string; previousBlob?: string },
	) {
		this.#forkNamespace(fork);
		if (!/^quest\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(input.path) || !input.message.trim())
			throw new GitHubError("Approved quest file required");
		return this.#authorized(upstream, userId, {}, async () =>
			this.#withRepository(fork, { contents: "write" }, async (token, current) => {
				if (!current.fork || current.parent?.id !== upstream.id)
					throw new GitHubError("Contribution repository must fork this upstream");
				return this.#api(token, `${repositoryPath(fork)}/contents/${input.path}`, "PUT", {
					branch: branch(input.branch),
					path: input.path,
					content: Buffer.from(input.content).toString("base64"),
					message: input.message,
					...(input.previousBlob ? { sha: sha(input.previousBlob) } : {}),
				});
			}),
		);
	}

	mergePullRequest(repo: GitHubRepository, userId: string, pull: number, expectedHead: string) {
		return this.#authorized(repo, userId, { contents: "write", pull_requests: "write" }, (token) =>
			this.#api(token, `${repositoryPath(repo)}/pulls/${number(pull)}/merge`, "PUT", {
				sha: sha(expectedHead),
				merge_method: "merge",
			}),
		);
	}
}
