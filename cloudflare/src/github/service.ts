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
	allow_squash_merge?: boolean;
	allow_merge_commit?: boolean;
	allow_rebase_merge?: boolean;
}
interface PullHead {
	number: number;
	node_id: string;
	html_url: string;
	state: string;
	draft: boolean;
	title: string;
	body: string | null;
	created_at: string;
	head: { ref: string; sha: string; repo: { id: number; name: string; owner: { login: string } } | null };
}
export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}
/** A publication the bot cannot make, which needs a maintainer's decision rather than a retry. */
export class PublicationBlocked extends GitHubError {}

/** One file a publication sets or, with null content, deletes. */
export type Change = { path: string; content: Uint8Array | null; executable: boolean };
/** What a job may publish: its workflow, its target, and its one branch. */
export type Contribution = {
	workflow: "plan" | "start" | "iterate" | "bootstrap";
	target: string;
	branch: string;
	pull: number | null;
	/** When the job was created, in milliseconds; older pull requests on its branch are not its own. */
	createdAt: number;
};
/** The one branch a job may write, on the repository the service resolved for it. */
export interface Branch {
	repository: GitHubRepository;
	/** The branch's commit, or null when it does not exist yet. */
	head(): Promise<string | null>;
	/** Create a commit of `changes` on `parent` without moving the branch. */
	commit(parent: string, changes: Change[], message: string): Promise<string>;
	/** Move the branch from `from` (null creates it) to `to`; false when it moved first. */
	move(from: string | null, to: string): Promise<boolean>;
}
export type ContributionState = "enabled" | "paused";
export type Enrollment = GitHubRepository & { state: ContributionState };
/** A running job attempt whose project was disconnected, which its runner must stop. */
export type Stopped = { actor: string; runner: string; job: string; attempt: number };
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
/** Whether Git accepts `name` as a branch, per `git check-ref-format`. */
export function refName(name: string) {
	return !/[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|(^|\/)\.|\.lock($|\/)|[/.]$|^\/|^@$/.test(name);
}
function pullNumber(target: string) {
	const match = target.match(/^pulls\/(\d{1,15})$/);
	if (!match) throw new GitHubError("Invalid pull request target");
	return number(Number(match[1]));
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
	 * What a new job may start from: `resolve` picks it from complete
	 * observations, then this checks whether its revision has a flake for the
	 * runner's devShell.
	 */
	jobSource<T extends { revision: string }>(
		repo: GitHubRepository,
		userId: string,
		resolve: (state: ProjectState) => T,
	) {
		return this.#authorized(repo, userId, { contents: "read" }, async (token, current, installation) => {
			this.#public(current);
			const enrolled = await this.#state(repo, installation);
			if (enrolled === null) throw new GitHubError("Project is not enrolled for this installation");
			const state = await this.#observations(repo, installation);
			if (!state?.complete) throw new GitHubError("Refresh project activity before starting work");
			// Check the revision the job will run, such as a pull request's head.
			const job = resolve(state);
			let flake = true;
			try {
				await this.#api(token, `${repositoryPath(repo)}/contents/flake.nix?ref=${sha(job.revision)}`);
			} catch (error) {
				if (!(error instanceof GitHubError) || error.status !== 404) throw error;
				flake = false;
			}
			return { job, enabled: enrolled === "enabled", flake };
		});
	}

	previewProject(repo: GitHubRepository, userId: string) {
		return this.#authorized(repo, userId, { contents: "read" }, (token, current, installation) =>
			this.#preview(token, repo, current, installation),
		);
	}

	/** Change a project's contribution state, returning the running job attempts a disconnect removed. */
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
					// Jobs go with the project, so read the running attempts in the same transaction.
					const [running] = await this.#env.DB.batch<Stopped>([
						this.#env.DB.prepare(
							"SELECT actor,runner,id AS job,attempt FROM jobs WHERE repository=? AND state='running'",
						).bind(repo.id),
						this.#env.DB.prepare("DELETE FROM github_projects WHERE id=?").bind(repo.id),
					]);
					return running!.results;
				}
				if (state === "paused") {
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
				return [];
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

	/**
	 * Hand `action` the one branch a job may write: its branch on the service
	 * fork, or an iterated pull request's head when the bot can update it.
	 * Rechecks the requester's current authority and the project's enrollment.
	 */
	contribute<T>(
		upstream: GitHubRepository,
		userId: string,
		job: Contribution,
		action: (branch: Branch) => Promise<T>,
	) {
		const iterate = job.workflow === "iterate";
		return this.#authorized(
			upstream,
			userId,
			iterate ? { pull_requests: "read" } : {},
			async (token, current, installation) => {
				this.#public(current);
				if ((await this.#state(upstream, installation)) === null)
					throw new GitHubError("Project is not enrolled for this installation");
				if (!iterate)
					return this.#fork(upstream, upstream.name, { contents: "write" }, (forkToken, fork) =>
						action(this.#branch(forkToken, fork, job.branch)),
					);
				const pull = await this.#api<PullHead>(
					token,
					`${repositoryPath(upstream)}/pulls/${pullNumber(job.target)}`,
				);
				if (pull.state !== "open" || pull.head.ref !== job.branch)
					throw new GitHubError("The pull request was closed or its head branch changed");
				const head = pull.head.repo;
				if (head?.id === upstream.id)
					return this.#withRepository(upstream, { contents: "write" }, async (writeToken, latest) =>
						action(this.#branch(writeToken, latest, job.branch)),
					);
				if (head && this.#forkOwner(head.owner.login))
					return this.#fork(upstream, head.name, { contents: "write" }, (forkToken, fork) => {
						if (fork.id !== head.id) throw new GitHubError("Repository identity or availability changed");
						return action(this.#branch(forkToken, fork, job.branch));
					});
				throw new PublicationBlocked(
					"The pull request's head is in a contributor's fork, which the bot cannot update. Ask its author to apply the changes, or close it and start new work.",
				);
			},
		);
	}

	#forkOwner(owner: string) {
		return !!this.#env.GITHUB_FORK_OWNER && owner.toLowerCase() === this.#env.GITHUB_FORK_OWNER.toLowerCase();
	}

	/** The operator-provisioned fork of `upstream` in the service namespace, verified by parent ID. */
	async #fork<T>(
		upstream: GitHubRepository,
		repository: string,
		permissions: Permissions,
		action: (token: string, fork: Repository) => Promise<T>,
	) {
		const owner = this.#env.GITHUB_FORK_OWNER;
		if (!owner || !name(owner)) throw new GitHubError("Configured service fork namespace required");
		const missing = new GitHubError(`Provision the service fork ${owner}/${repository} of this upstream first`);
		// Only a missing installation or repository means the fork is unprovisioned.
		let found = false;
		try {
			return await this.#withInstallation({ owner, name: repository }, permissions, async (token) => {
				const fork = await this.#api<Repository>(token, `/repos/${owner}/${repository}`);
				if (
					!fork.fork ||
					fork.parent?.id !== upstream.id ||
					!this.#forkOwner(fork.owner.login) ||
					fork.archived ||
					fork.disabled
				)
					throw missing;
				found = true;
				return action(token, fork);
			});
		} catch (error) {
			throw !found && error instanceof GitHubError && error.status === 404 ? missing : error;
		}
	}

	#branch(token: string, repo: Repository, branch: string): Branch {
		if (!refName(branch) || branch === repo.default_branch)
			throw new PublicationBlocked("Jobs never write a repository's default branch");
		const path = `/repos/${repo.owner.login}/${repo.name}`;
		const ref = branch.split("/").map(encodeURIComponent).join("/");
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
		return {
			repository: { owner: repo.owner.login, name: repo.name, id: repo.id },
			head: async () => {
				try {
					const found = await this.#api<{ object: { sha: string; type: string } }>(
						token,
						`${path}/git/ref/heads/${ref}`,
					);
					if (found.object.type !== "commit") throw new GitHubError("Branch must point at a commit");
					return sha(found.object.sha);
				} catch (error) {
					if (error instanceof GitHubError && error.status === 404) return null;
					throw error;
				}
			},
			commit: async (parent, changes, message) => {
				const base = await this.#api<{ tree: { sha: string } }>(token, `${path}/git/commits/${sha(parent)}`);
				const tree = [];
				for (const change of changes) {
					const mode = change.executable ? "100755" : "100644";
					if (change.content === null) {
						tree.push({ path: change.path, mode, type: "blob", sha: null });
						continue;
					}
					// Text goes inline in the tree request; other bytes need their own blob.
					let content: string | null = null;
					try {
						content = text.decode(change.content);
					} catch {}
					if (content !== null && !content.includes("\0")) {
						tree.push({ path: change.path, mode, type: "blob", content });
						continue;
					}
					const blob = await this.#api<{ sha: string }>(token, `${path}/git/blobs`, "POST", {
						content: Buffer.from(change.content).toString("base64"),
						encoding: "base64",
					});
					tree.push({ path: change.path, mode, type: "blob", sha: sha(blob.sha) });
				}
				const created = await this.#api<{ sha: string }>(token, `${path}/git/trees`, "POST", {
					base_tree: sha(base.tree.sha),
					tree,
				});
				// No author or committer: GitHub attributes and signs the commit as the App.
				const commit = await this.#api<{ sha: string }>(token, `${path}/git/commits`, "POST", {
					message,
					tree: sha(created.sha),
					parents: [parent],
				});
				return sha(commit.sha);
			},
			move: async (from, to) => {
				try {
					if (from === null)
						await this.#api(token, `${path}/git/refs`, "POST", {
							ref: `refs/heads/${branch}`,
							sha: sha(to),
						});
					// Fast-forward only, so an update built on a stale head cannot overwrite newer work.
					else
						await this.#api(token, `${path}/git/refs/heads/${ref}`, "PATCH", {
							sha: sha(to),
							force: false,
						});
					return true;
				} catch (error) {
					if (error instanceof GitHubError && (error.status === 409 || error.status === 422)) return false;
					throw error;
				}
			},
		};
	}

	/**
	 * Open the job's pull request from its service fork branch, or update the
	 * one it already opened. A closed pull request is not replaced.
	 */
	deliver(
		upstream: GitHubRepository,
		userId: string,
		job: Contribution,
		input: { title: string; body: string; draft: boolean },
	) {
		if (job.workflow === "iterate")
			throw new GitHubError("An iteration updates its pull request's head and opens no pull request");
		return this.#authorized(upstream, userId, { pull_requests: "write" }, async (token, current, installation) => {
			this.#public(current);
			if ((await this.#state(upstream, installation)) !== "enabled")
				throw new GitHubError("Contributions are paused");
			const fork = await this.#fork(upstream, upstream.name, {}, async (_token, fork) => fork);
			const pulls = `${repositoryPath(upstream)}/pulls`;
			const label = `${fork.owner.login}:${job.branch}`;
			// An unrecorded earlier delivery may have opened one, which the maintainer may since have closed.
			// GitHub reports whole seconds, so compare against the second the job was created in.
			const since = Math.floor(job.createdAt / 1000) * 1000;
			const opened = async () =>
				(
					await this.#api<PullHead[]>(
						token,
						`${pulls}?state=all&per_page=100&head=${encodeURIComponent(label)}`,
					)
				).find((pull) => Date.parse(pull.created_at) >= since) ?? null;
			let pull = job.pull ? await this.#api<PullHead>(token, `${pulls}/${number(job.pull)}`) : await opened();
			if (pull && (pull.head.repo?.id !== fork.id || pull.head.ref !== job.branch))
				throw new GitHubError("The job's pull request no longer comes from its branch");
			if (pull && pull.state !== "open")
				throw new GitHubError("The job's pull request was closed; reopen it on GitHub to deliver again");
			if (!pull) {
				try {
					pull = await this.#api<PullHead>(token, pulls, "POST", {
						head: label,
						// GitHub requires the head repository for cross-organization pull requests.
						head_repo: fork.name,
						base: current.default_branch,
						title: input.title,
						body: input.body,
						draft: input.draft,
						// Installation tokens cannot span both owners, so the upstream
						// token cannot grant maintainers edits on the fork branch.
						maintainer_can_modify: false,
					});
				} catch (error) {
					// A concurrent delivery may have opened it first.
					if (!(error instanceof GitHubError) || error.status !== 422) throw error;
					pull = await opened();
					if (pull?.state !== "open") throw error;
				}
			}
			if (pull.title !== input.title || pull.body !== input.body)
				pull = await this.#api<PullHead>(token, `${pulls}/${number(pull.number)}`, "PATCH", {
					title: input.title,
					body: input.body,
				});
			// Finished work leaves draft; a maintainer's own choice to mark it ready is never reverted.
			if (pull.draft && !input.draft) {
				const result = await this.#api<{ errors?: unknown[] }>(token, "/graphql", "POST", {
					query: "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }",
					variables: { id: pull.node_id },
				});
				if (result.errors?.length) throw new GitHubError("Could not mark the pull request ready for review");
				pull = { ...pull, draft: false };
			}
			return { number: number(pull.number), url: pull.html_url, draft: pull.draft };
		});
	}

	/**
	 * Merge exactly `expectedHead` with the first method the repository
	 * allows: squash, then a merge commit, then rebase. GitHub enforces branch
	 * rules, reviews, and checks.
	 */
	mergePullRequest(repo: GitHubRepository, userId: string, pull: number, expectedHead: string) {
		return this.#authorized(repo, userId, { contents: "write", pull_requests: "write" }, (token, current) => {
			const method = current.allow_squash_merge
				? "squash"
				: current.allow_merge_commit
					? "merge"
					: current.allow_rebase_merge
						? "rebase"
						: null;
			if (!method) throw new GitHubError("The repository allows no merge method");
			return this.#api(token, `${repositoryPath(repo)}/pulls/${number(pull)}/merge`, "PUT", {
				sha: sha(expectedHead),
				merge_method: method,
			});
		});
	}
}
