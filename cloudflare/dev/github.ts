// A fake of the GitHub (and SPDX) endpoints the Worker calls, answering from
// an in-memory world. It backs the seeded local server and the seed test, so it
// never holds or forwards real credentials, and it refuses anything it does not model.
import { createHash } from "node:crypto";

export type User = { id: number; login: string; name: string; email: string };
export type Issue = { number: number; title: string; author: string; comments?: number; closed?: boolean };
export type Pull = Issue & {
	/** Head branch; `quest/<path>` associates the pull request with that quest. */
	branch: string;
	checks: "SUCCESS" | "FAILURE" | "PENDING" | null;
	review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	reviews?: { state: string; author: string }[];
	draft?: boolean;
	/** Opened from the service fork, so its branch is not on the upstream. */
	fork?: boolean;
	/** A `## Decisions needed` section in it hands a draft back to the maintainer. */
	body?: string;
	/** GitHub's mergeStateStatus; only CLEAN merges. Defaults to BLOCKED, or DRAFT for a draft. */
	merge?: "CLEAN" | "BLOCKED" | "DIRTY" | "UNSTABLE" | "UNKNOWN";
};
export type Repo = {
	id: number;
	owner: string;
	name: string;
	/** Logins with the maintain role; everyone else can only read. */
	maintainers: string[];
	files: { path: string; content: string }[];
	issues: Issue[];
	pulls: Pull[];
	/** Quest branches pushed without a pull request, such as `quest/m0/docs`. */
	claims: string[];
	/** Branches on the repository's service fork, `<forks>/<name>`, and their commits. */
	fork: Record<string, string>;
};
export type World = {
	app: { id: number; slug: string };
	installation: number;
	/** The service fork namespace, `GITHUB_FORK_OWNER`. */
	forks: string;
	users: User[];
	repos: Repo[];
};

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
/** The Git object ID of a file's content, which the Worker verifies. */
export const blob = (content: string) => {
	const bytes = Buffer.from(content, "utf8");
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};
export const commitOf = (repo: Repo) => sha1(`commit ${repo.owner}/${repo.name}`);
const treeOf = (repo: Repo) => sha1(`tree ${repo.owner}/${repo.name}`);
export const headOf = (repo: Repo, pull: Pull) => sha1(`head ${repo.owner}/${repo.name}#${pull.number}`);
// GitHub's database IDs differ from numbers; derive stable ones per repository.
export const databaseId = (repo: Repo, number: number) => String(repo.id * 1000 + number);
const updatedAt = "2026-10-20T12:00:00Z";

function entity(repo: Repo, item: Issue) {
	return {
		databaseId: databaseId(repo, item.number),
		number: item.number,
		title: item.title,
		state: item.closed ? "CLOSED" : "OPEN",
		updatedAt,
		closedAt: item.closed ? updatedAt : null,
		author: { login: item.author },
		comments: { totalCount: item.comments ?? 0 },
	};
}

function pullNode(repo: Repo, pull: Pull) {
	const oid = headOf(repo, pull);
	const reviews = pull.reviews ?? [];
	return {
		...entity(repo, pull),
		body: pull.body ?? "",
		headRefName: pull.branch,
		headRefOid: oid,
		isDraft: !!pull.draft,
		reviewDecision: pull.review,
		mergeStateStatus: pull.merge ?? (pull.draft ? "DRAFT" : "BLOCKED"),
		reviews: { totalCount: reviews.length },
		latestReviews: {
			nodes: reviews.map((r) => ({ state: r.state, author: { login: r.author }, commit: { oid } })),
			pageInfo: { hasNextPage: false },
		},
		commits: { nodes: [{ commit: { oid, statusCheckRollup: pull.checks ? { state: pull.checks } : null } }] },
	};
}

const page = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

function graphql(repo: Repo, query: string) {
	const blobs = [...query.matchAll(/(q\d+): object\(oid: "([0-9a-f]{40})"\)/g)];
	if (blobs.length) {
		const files = new Map(repo.files.map((file) => [blob(file.content), file.content]));
		const objects = Object.fromEntries(
			blobs.map(([, alias, oid]) => {
				const text = files.get(oid!);
				return [alias, text === undefined ? null : { oid, text, isBinary: false, isTruncated: false }];
			}),
		);
		return { data: { repository: objects } };
	}
	const open = repo.pulls.filter((pull) => !pull.closed);
	const result: Record<string, unknown> = {};
	if (query.includes("issues(")) result.issues = page(repo.issues.map((issue) => entity(repo, issue)));
	if (/(?<!:)pullRequests\(/.test(query)) result.pullRequests = page(repo.pulls.map((pull) => pullNode(repo, pull)));
	if (query.includes("open:pullRequests(")) result.open = page(open.map((pull) => pullNode(repo, pull)));
	if (query.includes("refs(")) {
		const branches = [
			...repo.claims,
			...open.flatMap((p) => (p.branch.startsWith("quest/") && !p.fork ? [p.branch] : [])),
		];
		result.refs = page(
			[...new Set(branches.map((b) => b.replace(/^quest\//, "")))].map((name) => ({
				name,
				prefix: "refs/heads/quest/",
			})),
		);
	}
	// Entities a webhook named, read by number as GitHub does: an issue number
	// that is a pull request, or a missing one, is NOT_FOUND at its alias.
	const errors: unknown[] = [];
	for (const [, alias, field, number] of query.matchAll(/(s\d+):(issue|pullRequest)\(number:(\d+)\)/g)) {
		const pull = repo.pulls.find((p) => p.number === Number(number));
		const issue = repo.issues.find((i) => i.number === Number(number));
		const found = field === "pullRequest" ? pull && pullNode(repo, pull) : issue && entity(repo, issue);
		result[alias!] = found ?? null;
		if (!found) errors.push({ type: "NOT_FOUND", path: ["repository", alias] });
	}
	return { data: { repository: result }, ...(errors.length ? { errors } : {}) };
}

function tree(repo: Repo) {
	const dirs = new Set<string>();
	for (const file of repo.files) {
		const parts = file.path.split("/");
		for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
	}
	return {
		sha: treeOf(repo),
		truncated: false,
		tree: [
			...[...dirs].map((path) => ({ path, type: "tree", mode: "040000", sha: sha1(`dir ${path}`) })),
			...repo.files.map((file) => ({ path: file.path, type: "blob", mode: "100644", sha: blob(file.content) })),
		],
	};
}

/**
 * Answer one outbound request from the Worker. Sign-in always completes as the
 * world's first user; repository reads check that user's maintainer role.
 */
export function fakeGitHub(world: World) {
	const json = (body: unknown, status = 200) => Response.json(body, { status });
	// Called like fetch, with the runtime's checks: workerd's fetch throws when
	// called as another object's method, and building the Request validates
	// RequestInit as the real fetch does, refusing `redirect: "error"`.
	return async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		if (this !== undefined && this !== globalThis)
			throw new TypeError("Illegal invocation: fetch called as a method");
		const request = new Request(input, init);
		const url = new URL(request.url);
		const method = request.method;
		const body = () => request.text();
		const missing = () => {
			console.warn(`fake GitHub: no model for ${method} ${url}`);
			return json({ message: "Not modeled by the fake GitHub" }, 501);
		};
		const path = url.pathname;
		const me = world.users[0]!;
		if (url.origin === "https://spdx.org") return json({ licenseId: "MIT", isOsiApproved: true });
		if (url.origin === "https://github.com" && path === "/login/oauth/access_token")
			return json({ access_token: "fake-user-token", token_type: "bearer", scope: "read:user,user:email" });
		if (url.origin !== "https://api.github.com") return missing();
		if (path === "/user") return json({ id: me.id, login: me.login, name: me.name, email: me.email });
		if (path === "/user/emails") return json([{ email: me.email, primary: true, verified: true }]);
		if (path === "/app") return json({ id: world.app.id, slug: world.app.slug });
		if (path === "/installation/token" && method === "DELETE") return new Response(null, { status: 204 });
		if (/^\/app\/installations\/\d+\/access_tokens$/.test(path))
			return json({ token: "fake-installation-token" }, 201);
		const user = path.match(/^\/user\/(\d+)$/);
		if (user) {
			const found = world.users.find((u) => String(u.id) === user[1]);
			return found ? json({ id: found.id, login: found.login }) : json({ message: "Not Found" }, 404);
		}
		if (path === "/graphql") {
			const { query, variables } = JSON.parse(await body()) as {
				query: string;
				variables: Record<string, string>;
			};
			const repo = world.repos.find((r) => r.owner === variables.owner && r.name === variables.name);
			return repo ? json(graphql(repo, query)) : json({ errors: [{ message: "Not Found" }] });
		}
		const match = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
		const upstream = match?.[1] === world.forks && world.repos.find((r) => r.name === match[2]);
		if (upstream) return serviceFork(upstream, match![3] ?? "", method, await body());
		const repo = match && world.repos.find((r) => r.owner === match[1] && r.name === match[2]);
		if (!repo) return json({ message: "Not Found" }, 404);
		const rest = match![3] ?? "";
		const all = Object.fromEntries(
			["metadata", "contents", "issues", "pull_requests", "checks", "statuses"].map((p) => [p, "write"]),
		);
		if (rest === "")
			return json({
				id: repo.id,
				name: repo.name,
				owner: { login: repo.owner },
				private: false,
				visibility: "public",
				default_branch: "main",
				archived: false,
				disabled: false,
				license: { spdx_id: "MIT" },
				allow_squash_merge: true,
			});
		if (rest === "/installation")
			return json({ id: world.installation, app_id: world.app.id, suspended_at: null, permissions: all });
		const permission = rest.match(/^\/collaborators\/([^/]+)\/permission$/);
		if (permission) {
			const found = world.users.find((u) => u.login === permission[1]);
			if (!found) return json({ message: "Not Found" }, 404);
			const role = repo.maintainers.includes(found.login) ? "maintain" : "read";
			return json({
				user: { id: found.id },
				permission: role === "maintain" ? "write" : "read",
				role_name: role,
			});
		}
		if (rest === "/commits/main") return json({ sha: commitOf(repo), commit: { tree: { sha: treeOf(repo) } } });
		if (rest === `/git/trees/${treeOf(repo)}`) return json(tree(repo));
		const item = rest.match(/^\/(issues|pulls)\/(\d+)$/);
		if (item) {
			const list: Issue[] = item[1] === "pulls" ? repo.pulls : repo.issues;
			const found = list.find((i) => String(i.number) === item[2]);
			if (!found) return json({ message: "Not Found" }, 404);
			const head = item[1] === "pulls" ? { head: { sha: headOf(repo, found as Pull) } } : {};
			return json({ number: found.number, title: found.title, state: found.closed ? "closed" : "open", ...head });
		}
		const merge = rest.match(/^\/pulls\/(\d+)\/merge$/);
		if (merge && method === "PUT") {
			const pull = repo.pulls.find((p) => String(p.number) === merge[1] && !p.closed);
			if (!pull) return json({ message: "Not Found" }, 404);
			const { sha } = JSON.parse(await body()) as { sha: string };
			if (sha !== headOf(repo, pull)) return json({ message: "Head branch was modified" }, 409);
			if (pull.merge !== "CLEAN") return json({ message: "Pull Request is not mergeable" }, 405);
			pull.closed = true;
			return json({ sha: commitOf(repo), merged: true, message: "Pull Request successfully merged" });
		}
		if (rest.startsWith("/contents/")) {
			const file = repo.files.find((f) => f.path === decodeURIComponent(rest.slice("/contents/".length)));
			return file ? json({ type: "file", path: file.path }) : json({ message: "Not Found" }, 404);
		}
		return missing();
	};

	/** The upstream's service fork: its identity and the branch moves that resetting a job's branch makes. */
	function serviceFork(upstream: Repo, rest: string, method: string, text: string) {
		const forkId = upstream.id * 10;
		if (rest === "")
			return json({
				id: forkId,
				name: upstream.name,
				owner: { login: world.forks },
				fork: true,
				parent: { id: upstream.id },
				private: false,
				visibility: "public",
				default_branch: "main",
				archived: false,
				disabled: false,
			});
		if (rest === "/installation")
			return json({
				id: world.installation,
				app_id: world.app.id,
				suspended_at: null,
				permissions: { metadata: "read", contents: "write" },
			});
		const ref = rest.match(/^\/git\/refs?\/heads\/(.+)$/)?.[1];
		const branch = ref && decodeURIComponent(ref);
		if (branch && method === "GET") {
			const sha = upstream.fork[branch];
			return sha ? json({ object: { type: "commit", sha } }) : json({ message: "Not Found" }, 404);
		}
		const input = text ? (JSON.parse(text) as { ref?: string; sha: string; force?: boolean }) : null;
		// Only forced updates are modeled; a fast-forward needs commit history the fake does not keep.
		if (branch && method === "PATCH" && input?.force) {
			if (!upstream.fork[branch]) return json({ message: "Reference does not exist" }, 422);
			upstream.fork[branch] = input.sha;
			return json({ object: { type: "commit", sha: input.sha } });
		}
		if (rest === "/git/refs" && method === "POST" && input?.ref?.startsWith("refs/heads/")) {
			const name = input.ref.slice("refs/heads/".length);
			if (upstream.fork[name]) return json({ message: "Reference already exists" }, 422);
			upstream.fork[name] = input.sha;
			return json({ object: { type: "commit", sha: input.sha } }, 201);
		}
		console.warn(`fake GitHub: no model for ${method} ${world.forks}/${upstream.name}${rest}`);
		return json({ message: "Not modeled by the fake GitHub" }, 501);
	}
}

/** Sign a webhook body the way GitHub does. */
export async function webhookSignature(secret: string, body: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return "sha256=" + Buffer.from(digest).toString("hex");
}
