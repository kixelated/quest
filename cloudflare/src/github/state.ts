import { parse, ready } from "quest/core";
import type { Project, Snapshot } from "../board/project";
import { GitHubError, type GitHubRepository } from "./service";
import { positiveId } from "./webhook";

type Cursor = string | null | false;
export type Scan = {
	/** Pages every issue and PR, so edits to old entities and deletions are found. */
	history: { id: string; issues: Cursor; pulls: Cursor; complete: boolean };
	/** Pages only what availability depends on: open PRs and quest branches. */
	occupancy: { open: Cursor; refs: Cursor; pulls: string[]; claims: string[]; complete: boolean };
};
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Entity = {
	databaseId: string;
	number: number;
	title: string;
	state: string;
	updatedAt: string;
	author: { login: string } | null;
	comments: { totalCount: number };
};
export type Pull = Entity & {
	headRefName: string;
	headRefOid: string;
	isDraft: boolean;
	reviewDecision: string | null;
	/** GitHub's merge readiness for the App, such as CLEAN, BLOCKED, or DIRTY; absent in older observations. */
	mergeStateStatus?: string;
	reviews: { totalCount: number };
	latestReviews: {
		nodes: { state: string; author: { login: string } | null; commit: { oid: string } | null }[];
		pageInfo: { hasNextPage: boolean };
	};
	commits: { nodes: { commit: { oid: string; statusCheckRollup: { state: string } | null } }[] };
};
export type ActivityPage = {
	issues?: Connection<Entity>;
	pullRequests?: Connection<Pull>;
	open?: Connection<Pull>;
	refs?: Connection<{ name: string; prefix: string }>;
	/** Stale entities read by number, in the order requested; null when GitHub no longer has one. */
	[stale: `s${number}`]: Entity | Pull | null | undefined;
};
/** An entity a webhook named since it was last read, and how many times. */
export type Stale = { kind: "issue" | "pull"; id: string; number: number; stale: number };
export type Activity = {
	kind: "issue" | "pull";
	id: string;
	number: number;
	firstSeen: number;
	changedAt: number;
	data: Entity | Pull | null;
	missing: number;
};
export type ProjectState = {
	project: Project;
	activity: Activity[];
	claims: string[];
	complete: boolean;
	observedAt: number;
	revision: number;
	/** PRs the latest occupancy pass found open, or null until it completes after the last invalidating webhook. */
	open: string[] | null;
	/** Why the last background read failed, until a read or refresh succeeds. */
	failure: string | null;
};

const entityFields = "databaseId:fullDatabaseId number title state updatedAt author { login } comments { totalCount }";
const pullFields = `${entityFields} headRefName headRefOid isDraft reviewDecision mergeStateStatus reviews { totalCount } latestReviews(first:20) { nodes { state author {login} commit {oid} } pageInfo {hasNextPage} } commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } }`;
// Cursor variables are declared only for unfinished connections (GraphQL rejects
// unused variables). Fixed page sizes bound subrequests, independent of tree size.
export function activityQuery({ history, occupancy }: Scan, stale: Stale[] = []) {
	const fields: string[] = [];
	const variables = ["$owner: String!", "$name: String!"];
	if (history.issues !== false) {
		variables.push("$issues: String");
		fields.push(
			`issues(first:50,after:$issues,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${entityFields} } pageInfo { hasNextPage endCursor } }`,
		);
	}
	if (history.pulls !== false) {
		variables.push("$pulls: String");
		fields.push(
			`pullRequests(first:50,after:$pulls,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${pullFields} } pageInfo { hasNextPage endCursor } }`,
		);
	}
	if (occupancy.open !== false) {
		variables.push("$open: String");
		fields.push(
			`open:pullRequests(states:OPEN,first:100,after:$open,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${pullFields} } pageInfo { hasNextPage endCursor } }`,
		);
	}
	if (occupancy.refs !== false) {
		variables.push("$refs: String");
		fields.push(
			'refs(refPrefix:"refs/heads/quest/",first:100,after:$refs) { nodes { name prefix } pageInfo { hasNextPage endCursor } }',
		);
	}
	// Numbers come from validated webhook pointers and are interpolated as integers.
	stale.forEach((entity, i) => {
		if (!positiveId(entity.number)) throw new GitHubError("Invalid entity observation");
		fields.push(
			entity.kind === "pull"
				? `s${i}:pullRequest(number:${entity.number}) { ${pullFields} }`
				: `s${i}:issue(number:${entity.number}) { ${entityFields} }`,
		);
	});
	return `query(${variables.join(",")}) { repository(owner:$owner,name:$name) { ${fields.join("\n")} } }`;
}

function next<T>(connection: Connection<T> | undefined, cursor: Cursor) {
	if (cursor === false) return false;
	if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo)
		throw new GitHubError("Incomplete project activity");
	if (!connection.pageInfo.hasNextPage) return false;
	if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor)
		throw new GitHubError("Invalid project activity cursor");
	return connection.pageInfo.endCursor;
}

/** A branch convention is evidence of association, never execution authority. */
export function associatedQuest(branch: string, paths: Set<string>) {
	const exact = `${branch}.md`;
	const epic = `${branch}/README.md`;
	return paths.has(exact) ? exact : paths.has(epic) ? epic : null;
}

function validate(kind: "issue" | "pull", item: Entity) {
	if (
		typeof item.databaseId !== "string" ||
		!/^[1-9]\d*$/.test(item.databaseId) ||
		!positiveId(item.number) ||
		typeof item.title !== "string" ||
		!Number.isFinite(Date.parse(item.updatedAt))
	)
		throw new GitHubError("Invalid entity observation");
	if (kind === "pull") {
		const pull = item as Pull;
		if (!/^[a-f0-9]{40}$/.test(pull.headRefOid) || pull.commits.nodes.at(-1)?.commit.oid !== pull.headRefOid)
			throw new GitHubError("Pull request head changed; refresh again");
	}
}

/** Entities that webhooks named since they were last read by number, oldest first. */
export async function staleEntities(db: D1Database, repository: number) {
	return (
		await db
			.prepare(
				"SELECT kind,id,number,stale FROM github_project_activity WHERE repository=? AND stale>0 ORDER BY changedAt,id LIMIT 50",
			)
			.bind(repository)
			.all<Stale>()
	).results;
}

export async function reconcile(
	db: D1Database,
	repo: GitHubRepository,
	snapshot: Snapshot,
	scan: Scan,
	page: ActivityPage,
	stale: Stale[],
	revision: number,
	epoch: string,
) {
	const now = Date.now();
	const { history, occupancy } = scan;
	const updated: Scan = {
		history: {
			id: history.id,
			issues: next(page.issues, history.issues),
			pulls: next(page.pullRequests, history.pulls),
			complete: false,
		},
		occupancy: {
			open: next(page.open, occupancy.open),
			refs: next(page.refs, occupancy.refs),
			pulls: [...occupancy.pulls],
			claims: [...occupancy.claims],
			complete: false,
		},
	};
	if (occupancy.refs !== false)
		for (const ref of page.refs!.nodes) {
			if (typeof ref.name !== "string" || ref.prefix !== "refs/heads/quest/")
				throw new GitHubError("Invalid branch observation");
			// Ref.name is relative to the requested prefix.
			updated.occupancy.claims.push(`quest/${ref.name}`);
		}
	updated.history.complete = updated.history.issues === false && updated.history.pulls === false;
	updated.occupancy.complete = updated.occupancy.open === false && updated.occupancy.refs === false;
	// Keyed by identity: an open PR can arrive from both PR connections at once.
	// `stale` is the webhook count a read by number saw, so only it is cleared.
	const entities = new Map<string, { kind: string; item: Entity; stale: number }>();
	for (const [kind, connection, cursor, open] of [
		["issue", page.issues, history.issues, false],
		["pull", page.pullRequests, history.pulls, false],
		["pull", page.open, occupancy.open, true],
	] as const) {
		if (cursor === false) continue;
		for (const item of connection!.nodes) {
			validate(kind, item);
			entities.set(`${kind}/${item.databaseId}`, { kind, item, stale: 0 });
			if (open) updated.occupancy.pulls.push(item.databaseId);
		}
	}
	// A read by number is the latest, so it replaces a page's copy.
	const gone: Stale[] = [];
	stale.forEach((entity, i) => {
		const item = page[`s${i}`];
		if (item === undefined) throw new GitHubError("Incomplete project activity");
		if (item) validate(entity.kind, item);
		// A number GitHub no longer resolves to this entity, such as a deleted issue.
		if (!item || item.databaseId !== entity.id) gone.push(entity);
		else entities.set(`${entity.kind}/${entity.id}`, { kind: entity.kind, item, stale: entity.stale });
	});
	updated.occupancy.claims = [...new Set(updated.occupancy.claims)];
	updated.occupancy.pulls = [...new Set(updated.occupancy.pulls)];
	const current = "EXISTS(SELECT 1 FROM github_project_state WHERE repository=? AND revision=? AND epoch=?)";
	// json_each keeps the transaction to four statements and a few bindings,
	// within D1's free query budget and SQLite's bound-parameter limit.
	const statements = [
		db
			.prepare(
				`INSERT INTO github_project_activity(repository,kind,id,number,firstSeen,changedAt,data,seenIn,stale)
 SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.item.databaseId'),json_extract(value,'$.item.number'),?,?,json_extract(value,'$.item'),?,json_extract(value,'$.stale')
 FROM json_each(?) WHERE ${current}
 ON CONFLICT(repository,kind,id) DO UPDATE SET number=excluded.number,changedAt=CASE WHEN github_project_activity.data IS NOT excluded.data THEN excluded.changedAt ELSE github_project_activity.changedAt END,data=excluded.data,seenIn=excluded.seenIn,missing=0,stale=CASE WHEN excluded.stale>0 AND github_project_activity.stale=excluded.stale THEN 0 ELSE github_project_activity.stale END`,
			)
			.bind(repo.id, now, now, history.id, JSON.stringify([...entities.values()]), repo.id, revision, epoch),
		db
			.prepare(
				`UPDATE github_project_activity SET missing=1,stale=CASE WHEN stale=json_extract(value,'$.stale') THEN 0 ELSE stale END
 FROM json_each(?) WHERE repository=? AND kind=json_extract(value,'$.kind') AND github_project_activity.id=json_extract(value,'$.id') AND ${current}`,
			)
			.bind(JSON.stringify(gone), repo.id, repo.id, revision, epoch),
		db
			.prepare(
				`UPDATE github_project_activity SET missing=1 WHERE repository=? AND (seenIn IS NULL OR seenIn<>?) AND ?=1 AND ${current}`,
			)
			.bind(repo.id, history.id, updated.history.complete ? 1 : 0, repo.id, revision, epoch),
		db
			.prepare(
				"UPDATE github_project_state SET snapshot=?,scan=?,observedAt=?,invalidated=0,failure=NULL,revision=revision+1 WHERE repository=? AND revision=? AND epoch=?",
			)
			.bind(JSON.stringify(snapshot), JSON.stringify(updated), now, repo.id, revision, epoch),
	];
	const result = await db.batch(statements);
	if (result.at(-1)!.meta.changes !== 1) throw new GitHubError("Project changed during refresh; refresh again");
}

export async function readState(db: D1Database, repo: GitHubRepository): Promise<ProjectState | null> {
	const records = await db.batch([
		db
			.prepare(
				"SELECT snapshot,scan,observedAt,revision,invalidated,failure FROM github_project_state WHERE repository=?",
			)
			.bind(repo.id),
		db
			.prepare(
				"SELECT kind,id,number,firstSeen,changedAt,data,missing FROM github_project_activity WHERE repository=? ORDER BY firstSeen DESC,id DESC",
			)
			.bind(repo.id),
	]);
	const row = records[0]!.results[0] as
		| {
				snapshot: string | null;
				scan: string | null;
				observedAt: number;
				revision: number;
				invalidated: number;
				failure: string | null;
		  }
		| undefined;
	if (!row?.snapshot || !row.scan) return null;
	const snapshot: Snapshot = JSON.parse(row.snapshot);
	const scan: Scan = JSON.parse(row.scan);
	const rows = records[1]!.results as (Omit<Activity, "data"> & { data: string | null })[];
	const activity: Activity[] = rows.map((item) => ({ ...item, data: item.data ? JSON.parse(item.data) : null }));
	const paths = new Set(snapshot.documents.map((d) => d.path));
	// A PR's activity row can still say OPEN until history rereads it, so only
	// PRs in the latest occupancy pass count as open.
	const open = new Set(scan.occupancy.pulls);
	const changes = activity
		.filter((item) => item.kind === "pull" && open.has(item.id) && !item.missing && item.data?.state === "OPEN")
		.flatMap((item) => {
			const pull = item.data as Pull;
			const quest = associatedQuest(pull.headRefName, paths);
			return quest
				? [
						{
							quest,
							author: pull.author?.login ?? "GitHub contributor",
							href: `https://github.com/${repo.owner}/${repo.name}/pull/${pull.number}`,
						},
					]
				: [];
		});
	const claims = scan.occupancy.claims
		.map((ref) => associatedQuest(ref, paths))
		.filter((q): q is string => q !== null);
	const occupied = new Set([...claims, ...changes.map((c) => c.quest)]);
	// Unknown until every open PR and quest branch is read since the last
	// webhook that could have opened, closed, or claimed a quest.
	const settled = scan.occupancy.complete && row.invalidated === 0;
	const available = settled
		? ready(snapshot.documents.map((d) => parse(d.path, d.content))).filter((path) => !occupied.has(path))
		: null;
	const project: Project = {
		...snapshot,
		name: `github/${repo.owner}/${repo.name}`,
		href: `/projects/github/${repo.owner}/${repo.name}/board`,
		title: `${repo.owner}/${repo.name}`,
		web: `https://github.com/${repo.owner}/${repo.name}`,
		changes,
		claims,
		issues: activity
			.filter((item) => item.kind === "issue" && !item.missing && item.data?.state === "OPEN")
			.map((item) => ({ path: `issues/${item.number}`, title: item.data!.title })),
		available,
	};
	return {
		project,
		activity,
		claims,
		complete: scan.history.complete,
		observedAt: row.observedAt,
		revision: row.revision,
		open: settled ? scan.occupancy.pulls : null,
		failure: row.failure,
	};
}
