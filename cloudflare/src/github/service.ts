import { createHash, createPrivateKey, sign } from "node:crypto";
import { check, isQuest, parse, ready } from "quest/core";
import { osiApproved } from "../licenses";
import { positiveId } from "./webhook";
import { activityQuery, type ActivityPage, type ProjectState, type Scan, reconcile, readState } from "./state";

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
	private: boolean;
	visibility: string;
	default_branch: string;
	license?: { spdx_id: string; name: string } | null;
}
export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}
export type ContributionState = "enabled" | "paused";
export type Enrollment = GitHubRepository & { state: ContributionState };
export type ProjectPreview = {
	repository: GitHubRepository;
	branch: string;
	commit: string;
	license: Repository["license"];
	licenseError: string | null;
	quests: { path: string; title: string }[];
	state: ContributionState | null;
};
type Tree = { truncated: boolean; tree: { path: string; type: string; mode: string; sha: string }[] };

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
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"User-Agent": "Quest-GitHub-App",
				"X-GitHub-Api-Version": "2026-03-10",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		// Never include provider response bodies, request headers, or secrets in errors.
		if (!response.ok) throw new GitHubError(`GitHub request failed (${response.status})`, response.status);
		return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
	}

	async #gate(id: number) {
		const state = await this.#env.DB.prepare("SELECT blocked FROM github_installations WHERE id=?")
			.bind(id)
			.first<{ blocked: number }>();
		if (state?.blocked) throw new GitHubError("GitHub installation revoked or suspended");
	}

	#repository(repo: GitHubRepository, current: Repository, allowUnavailable = false) {
		if (
			current.id !== repo.id ||
			current.owner.login.toLowerCase() !== repo.owner.toLowerCase() ||
			current.name.toLowerCase() !== repo.name.toLowerCase() ||
			(!allowUnavailable && (current.archived || current.disabled))
		)
			throw new GitHubError("Repository identity or availability changed");
	}

	async #license(current: Repository): Promise<string | null> {
		try {
			if (await osiApproved(current.license?.spdx_id, this.#fetch)) return null;
			return "GitHub must detect an OSI-approved license. Add or correct the repository license on GitHub, then review this project again.";
		} catch {
			return "License approval could not be verified. Contributions cannot be enabled while SPDX license data is unavailable.";
		}
	}

	async #withInstallation<T>(
		repo: Pick<GitHubRepository, "owner" | "name"> & { id?: number },
		permissions: Permissions,
		action: (token: string, installationId: number) => Promise<T>,
	) {
		if (!name(repo.owner) || !name(repo.name)) throw new GitHubError("Invalid repository");
		const path = `/repos/${repo.owner}/${repo.name}`;
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
			{
				...(repo.id === undefined ? { repositories: [repo.name] } : { repository_ids: [repo.id] }),
				permissions: scope,
			},
		);
		if (!minted.token) throw new GitHubError("Installation token unavailable");
		try {
			await this.#gate(installation.id);
			return await action(minted.token, installation.id);
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

	async #withRepository<T>(
		repo: GitHubRepository,
		permissions: Permissions,
		action: (token: string, current: Repository, installationId: number) => Promise<T>,
		allowUnavailable = false,
	) {
		const path = repositoryPath(repo);
		return this.#withInstallation(repo, permissions, async (token, installation) => {
			const current = await this.#api<Repository>(token, path);
			this.#repository(repo, current, allowUnavailable);
			await this.#gate(installation);
			return action(token, current, installation);
		});
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
		action: (token: string, current: Repository, installationId: number) => Promise<T>,
		allowUnavailable = false,
	) {
		return this.#withRepository(
			repo,
			permissions,
			async (token, current, installationId) => {
				await this.#maintainer(token, repo, userId);
				await this.#gate(installationId);
				return action(token, current, installationId);
			},
			allowUnavailable,
		);
	}

	/** The operator's registered App, rather than an assumed App name. */
	async installationURL() {
		const app = await this.#api<{ id: number; slug: string }>(this.#jwt(), "/app");
		if (String(app.id) !== this.#env.GITHUB_APP_ID || !/^[a-zA-Z0-9-]+$/.test(app.slug))
			throw new GitHubError("GitHub App unavailable");
		return `https://github.com/apps/${app.slug}/installations/new`;
	}

	/** Resolve public metadata through a repository-scoped App token. */
	async resolveRepository(owner: string, repository: string): Promise<GitHubRepository> {
		if (!name(owner) || !name(repository)) throw new GitHubError("Use an owner/repository name");
		return this.#withInstallation({ owner, name: repository }, {}, async (token) => {
			const found = await this.#api<Repository>(token, `/repos/${owner}/${repository}`);
			this.#public(found);
			const repo = { id: found.id, owner: found.owner.login, name: found.name };
			repositoryPath(repo);
			return repo;
		});
	}

	#public(current: Repository) {
		if (current.private !== false || current.visibility !== "public")
			throw new GitHubError("Select a public repository");
	}

	async #state(repo: GitHubRepository, installation: number) {
		const row = await this.#env.DB.prepare(
			"SELECT state FROM github_projects WHERE id=? AND owner=? COLLATE NOCASE AND name=? COLLATE NOCASE AND installation=?",
		)
			.bind(repo.id, repo.owner, repo.name, installation)
			.first<{ state: ContributionState }>();
		return row?.state ?? null;
	}

	async projects(userId: string): Promise<Enrollment[]> {
		// Remembered selections are navigation only, never an authority grant.
		return (
			await this.#env.DB.prepare(
				"SELECT id,owner,name,state FROM github_projects WHERE enrolledBy=? ORDER BY owner,name",
			)
				.bind(userId)
				.all<Enrollment>()
		).results;
	}

	/** Let any current maintainer reach stop controls without a valid preview. */
	async enrolledProject(owner: string, repository: string, userId: string): Promise<Enrollment | null> {
		return this.#withInstallation({ owner, name: repository }, {}, async (token, installation) => {
			const current = await this.#api<Repository>(token, `/repos/${owner}/${repository}`);
			const repo = { id: current.id, owner: current.owner.login, name: current.name };
			repositoryPath(repo);
			const enrolled = await this.#env.DB.prepare("SELECT state FROM github_projects WHERE id=?")
				.bind(repo.id)
				.first<{ state: ContributionState }>();
			if (!enrolled) return null;
			await this.#maintainer(token, repo, userId);
			await this.#gate(installation);
			// Names are navigation metadata, not identity. A rename must not hide
			// an existing enrollment from a current maintainer's stop controls.
			await this.#env.DB.prepare("UPDATE github_projects SET owner=?,name=? WHERE id=?")
				.bind(repo.owner, repo.name, repo.id)
				.run();
			return { ...repo, state: enrolled.state };
		});
	}

	async #snapshot(token: string, repo: GitHubRepository, current: Repository) {
		this.#public(current);
		if (!current.default_branch) throw new GitHubError("Repository default branch unavailable");
		const path = repositoryPath(repo);
		const commit = await this.#api<{ sha: string; commit: { tree: { sha: string } } }>(
			token,
			`${path}/commits/${encodeURIComponent(current.default_branch)}`,
		);
		sha(commit.sha);
		const root = await this.#api<Tree>(token, `${path}/git/trees/${sha(commit.commit.tree.sha)}?recursive=1`);
		if (root.truncated) throw new GitHubError("Repository tree is incomplete");
		const quest = root.tree.find((entry) => entry.path === "quest" && entry.type === "tree");
		if (!quest) throw new GitHubError("Quest files are required. Follow the existing Quest setup guide first.");
		const entries = root.tree.filter(
			(entry) => entry.path.startsWith("quest/") && isQuest(entry.path) && entry.type === "blob",
		);
		if (!entries.length)
			throw new GitHubError("Quest files are required. Follow the existing Quest setup guide first.");
		// Read the pinned blobs together: a REST request per file can exhaust a
		// Worker's subrequest budget during enrollment even for a small quest tree.
		const fields = entries.map((entry, i) => {
			if (!["100644", "100755"].includes(entry.mode)) throw new GitHubError("Quest files must be regular files");
			return `q${i}: object(oid: "${sha(entry.sha)}") { ... on Blob { oid text isBinary isTruncated } }`;
		});
		const result = await this.#api<{
			data?: {
				repository: Record<
					string,
					{ oid: string; text: string | null; isBinary: boolean | null; isTruncated: boolean } | null
				> | null;
			};
			errors?: unknown[];
		}>(token, "/graphql", "POST", {
			query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join("\n")} } }`,
			variables: { owner: repo.owner, name: repo.name },
		});
		if (result.errors?.length || !result.data?.repository) throw new GitHubError("Quest content unavailable");
		const blobs = result.data.repository;
		const files: { path: string; content: string }[] = [];
		const documents = entries.map((entry, i) => {
			const blob = blobs[`q${i}`];
			if (
				!blob ||
				blob.oid !== entry.sha ||
				blob.isBinary !== false ||
				blob.isTruncated !== false ||
				typeof blob.text !== "string"
			)
				throw new GitHubError("Quest content unavailable");
			// GraphQL supplies decoded text. Verify the Git object hash so a lossy
			// UTF-8 conversion cannot silently change the snapshot being validated.
			const content = Buffer.from(blob.text, "utf8");
			const oid = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
			if (oid !== entry.sha) throw new GitHubError("Quest content unavailable");
			files.push({ path: entry.path, content: blob.text });
			return parse(entry.path, blob.text);
		});
		const paths = new Set(root.tree.map((entry) => entry.path));
		if (check(documents, (path) => paths.has(path)).length)
			throw new GitHubError("Fix the quest tree with quest check before enabling contributions");
		const available = new Set(ready(documents));
		return {
			commit: commit.sha,
			date: new Date().toISOString().slice(0, 10),
			documents: files,
			completed: [],
			ready: documents
				.filter((doc) => available.has(doc.path))
				.map((doc) => ({ path: doc.path, title: doc.title?.text ?? doc.path })),
		};
	}

	async #preview(
		token: string,
		repo: GitHubRepository,
		current: Repository,
		installation: number,
	): Promise<ProjectPreview> {
		const snapshot = await this.#snapshot(token, repo, current);
		return {
			repository: repo,
			branch: current.default_branch,
			commit: snapshot.commit,
			license: current.license,
			licenseError: await this.#license(current),
			quests: snapshot.ready,
			state: await this.#state(repo, installation),
		};
	}

	async #observations(repo: GitHubRepository, installation: number) {
		const result = await readState(this.#env.DB, repo);
		const state = await this.#state(repo, installation);
		await this.#gate(installation);
		if (state === null) throw new GitHubError("Project enrollment changed");
		if (result && state !== "enabled") result.available = [];
		return result;
	}

	/** Observations only. Neither a refresh nor an arriving entity launches work. */
	projectState(repo: GitHubRepository, userId: string, refresh = false): Promise<ProjectState | null> {
		return this.#authorized(
			repo,
			userId,
			refresh
				? { contents: "read", issues: "read", pull_requests: "read", checks: "read", statuses: "read" }
				: {},
			async (token, current, installation) => {
				this.#public(current);
				if ((await this.#state(repo, installation)) === null)
					throw new GitHubError("Project is not enrolled for this installation");
				if (!refresh) return this.#observations(repo, installation);
				await this.#env.DB.prepare("INSERT OR IGNORE INTO github_project_state(repository,epoch) VALUES(?,?)")
					.bind(repo.id, crypto.randomUUID())
					.run();
				const row = await this.#env.DB.prepare(
					"SELECT revision,scan,invalidated,epoch FROM github_project_state WHERE repository=?",
				)
					.bind(repo.id)
					.first<{ revision: number; scan: string | null; invalidated: number; epoch: string }>();
				const previous: Scan | null = row?.scan ? JSON.parse(row.scan) : null;
				const scan: Scan =
					previous && !previous.complete && row?.invalidated !== 1
						? previous
						: {
								id: crypto.randomUUID(),
								issues: null,
								pulls: null,
								refs: null,
								claims: [],
								complete: false,
							};
				const snapshot = await this.#snapshot(token, repo, current);
				const response = await this.#api<{ data?: { repository: ActivityPage | null }; errors?: unknown[] }>(
					token,
					"/graphql",
					"POST",
					{
						query: activityQuery(scan),
						variables: {
							owner: repo.owner,
							name: repo.name,
							issues: scan.issues || null,
							pulls: scan.pulls || null,
							refs: scan.refs || null,
						},
					},
				);
				if (response.errors?.length || !response.data?.repository)
					throw new GitHubError("Project activity unavailable");
				// A rename, transfer, visibility change, revocation, or lost
				// maintainer role during the scan must not publish fresh observations.
				const latest = await this.#api<Repository>(token, repositoryPath(repo));
				this.#repository(repo, latest);
				this.#public(latest);
				if (latest.default_branch !== current.default_branch)
					throw new GitHubError("Default branch changed; refresh again");
				await this.#maintainer(token, repo, userId);
				await this.#gate(installation);
				if ((await this.#state(repo, installation)) === null)
					throw new GitHubError("Project enrollment changed");
				await reconcile(
					this.#env.DB,
					repo,
					snapshot,
					scan,
					response.data.repository,
					row!.revision,
					row!.epoch,
				);
				return this.#observations(repo, installation);
			},
		);
	}

	/**
	 * What a new job may start from: complete observations of the default
	 * branch, and whether that commit has a flake for the runner's devShell.
	 */
	jobSource(repo: GitHubRepository, userId: string) {
		return this.#authorized(repo, userId, { contents: "read" }, async (token, current, installation) => {
			this.#public(current);
			const enrolled = await this.#state(repo, installation);
			if (enrolled === null) throw new GitHubError("Project is not enrolled for this installation");
			const state = await this.#observations(repo, installation);
			if (!state?.complete) throw new GitHubError("Refresh project activity before starting work");
			let flake = true;
			try {
				await this.#api(token, `${repositoryPath(repo)}/contents/flake.nix?ref=${sha(state.project.commit)}`);
			} catch (error) {
				if (!(error instanceof GitHubError) || error.status !== 404) throw error;
				flake = false;
			}
			return { state, enabled: enrolled === "enabled", flake };
		});
	}

	previewProject(repo: GitHubRepository, userId: string) {
		return this.#authorized(repo, userId, { contents: "read" }, (token, current, installation) =>
			this.#preview(token, repo, current, installation),
		);
	}

	setContributions(repo: GitHubRepository, userId: string, state: ContributionState | "disconnected") {
		if (!["enabled", "paused", "disconnected"].includes(state)) throw new GitHubError("Invalid contribution state");
		return this.#authorized(
			repo,
			userId,
			state === "enabled" ? { contents: "read" } : {},
			async (token, current, installation) => {
				if (state === "enabled") {
					const preview = await this.#preview(token, repo, current, installation);
					if (preview.licenseError) throw new GitHubError(preview.licenseError);
					// The repository or license can change during content reads. Check
					// current eligibility again, rather than persisting the preview's grant.
					const latest = await this.#api<Repository>(token, repositoryPath(repo));
					this.#repository(repo, latest);
					this.#public(latest);
					if (
						latest.default_branch !== current.default_branch ||
						latest.license?.spdx_id !== current.license?.spdx_id
					)
						throw new GitHubError("Repository eligibility changed; review this project again");
					const licenseError = await this.#license(latest);
					if (licenseError) throw new GitHubError(licenseError);
					await this.#maintainer(token, repo, userId);
				}
				// Recheck the local revocation gate after potentially long content reads.
				await this.#gate(installation);
				if (state === "disconnected") {
					await this.#env.DB.prepare("DELETE FROM github_projects WHERE id=?").bind(repo.id).run();
				} else if (state === "paused") {
					await this.#env.DB.prepare("UPDATE github_projects SET state='paused',updatedAt=? WHERE id=?")
						.bind(Date.now(), repo.id)
						.run();
				} else {
					await this.#env.DB.batch([
						this.#env.DB.prepare(
							"DELETE FROM github_project_state WHERE repository=? AND EXISTS(SELECT 1 FROM github_projects WHERE id=? AND installation<>?)",
						).bind(repo.id, repo.id, installation),
						this.#env.DB.prepare(
							"DELETE FROM github_project_activity WHERE repository=? AND EXISTS(SELECT 1 FROM github_projects WHERE id=? AND installation<>?)",
						).bind(repo.id, repo.id, installation),
						this.#env.DB.prepare(
							`INSERT INTO github_projects(id,owner,name,installation,state,enrolledBy,updatedAt) VALUES(?,?,?,?,'enabled',?,?)
					ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,name=excluded.name,installation=excluded.installation,state=excluded.state,updatedAt=excluded.updatedAt`,
						).bind(repo.id, repo.owner, repo.name, installation, userId, Date.now()),
					]);
				}
			},
			state !== "enabled",
		);
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
				// The upstream-scoped token has no write access to the fork's head
				// branch, so it cannot grant maintainers edits there. Installation
				// tokens cannot span both owners; the fork token only pushes.
				maintainer_can_modify: false,
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
