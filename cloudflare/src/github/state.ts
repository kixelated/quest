import { parse, ready } from "quest/core";
import type { Project, Snapshot } from "../board/project";
import { GitHubError, type GitHubRepository } from "./service";
import { positiveId } from "./webhook";

export type Scan = {
	id: string;
	issues: string | null | false;
	pulls: string | null | false;
	refs: string | null | false;
	claims: string[];
	complete: boolean;
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
	refs?: Connection<{ name: string; prefix: string }>;
};
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
	available: string[];
	complete: boolean;
	observedAt: number;
	revision: number;
};

const entityFields = "databaseId:fullDatabaseId number title state updatedAt author { login } comments { totalCount }";
// Cursor variables are declared only for unfinished connections (GraphQL rejects
// unused variables). Fixed page sizes bound subrequests, independent of tree size.
export function activityQuery(scan: Scan) {
	const fields: string[] = [];
	const variables = ["$owner: String!", "$name: String!"];
	if (scan.issues !== false) {
		variables.push("$issues: String");
		fields.push(
			`issues(first:50,after:$issues,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${entityFields} } pageInfo { hasNextPage endCursor } }`,
		);
	}
	if (scan.pulls !== false) {
		variables.push("$pulls: String");
		fields.push(
			`pullRequests(first:50,after:$pulls,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${entityFields} headRefName headRefOid isDraft reviewDecision reviews { totalCount } latestReviews(first:20) { nodes { state author {login} commit {oid} } pageInfo {hasNextPage} } commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } } } pageInfo { hasNextPage endCursor } }`,
		);
	}
	if (scan.refs !== false) {
		variables.push("$refs: String");
		fields.push(
			'refs(refPrefix:"refs/heads/quest/",first:100,after:$refs) { nodes { name prefix } pageInfo { hasNextPage endCursor } }',
		);
	}
	return `query(${variables.join(",")}) { repository(owner:$owner,name:$name) { ${fields.join("\n")} } }`;
}

function next<T>(connection: Connection<T> | undefined, cursor: Scan["issues"]) {
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

export async function reconcile(
	db: D1Database,
	repo: GitHubRepository,
	snapshot: Snapshot,
	scan: Scan,
	page: ActivityPage,
	revision: number,
	epoch: string,
) {
	const now = Date.now();
	const updated: Scan = {
		id: scan.id,
		issues: next(page.issues, scan.issues),
		pulls: next(page.pullRequests, scan.pulls),
		refs: next(page.refs, scan.refs),
		claims: [...scan.claims],
		complete: false,
	};
	if (scan.refs !== false)
		for (const ref of page.refs!.nodes) {
			if (typeof ref.name !== "string" || ref.prefix !== "refs/heads/quest/")
				throw new GitHubError("Invalid branch observation");
			// Ref.name is relative to the requested prefix.
			updated.claims.push(`quest/${ref.name}`);
		}
	updated.claims = [...new Set(updated.claims)];
	updated.complete = updated.issues === false && updated.pulls === false && updated.refs === false;
	const entities: { kind: string; item: Entity }[] = [];
	for (const [kind, connection] of [
		["issue", page.issues],
		["pull", page.pullRequests],
	] as const) {
		if (scan[kind === "issue" ? "issues" : "pulls"] === false) continue;
		for (const item of connection!.nodes) {
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
				if (
					!/^[a-f0-9]{40}$/.test(pull.headRefOid) ||
					pull.commits.nodes.at(-1)?.commit.oid !== pull.headRefOid
				)
					throw new GitHubError("Pull request head changed; refresh again");
			}
			entities.push({ kind, item });
		}
	}
	// json_each keeps the transaction to three statements and a few bindings,
	// within D1's free query budget and SQLite's bound-parameter limit.
	const statements = [
		db
			.prepare(
				`INSERT INTO github_project_activity(repository,kind,id,number,firstSeen,changedAt,data,seenIn)
 SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.item.databaseId'),json_extract(value,'$.item.number'),?,?,json_extract(value,'$.item'),?
 FROM json_each(?) WHERE EXISTS(SELECT 1 FROM github_project_state WHERE repository=? AND revision=? AND epoch=?)
 ON CONFLICT(repository,kind,id) DO UPDATE SET number=excluded.number,changedAt=CASE WHEN github_project_activity.data IS NOT excluded.data THEN excluded.changedAt ELSE github_project_activity.changedAt END,data=excluded.data,seenIn=excluded.seenIn,missing=0`,
			)
			.bind(repo.id, now, now, scan.id, JSON.stringify(entities), repo.id, revision, epoch),
		db
			.prepare(
				"UPDATE github_project_activity SET missing=1 WHERE repository=? AND (seenIn IS NULL OR seenIn<>?) AND ?=1 AND EXISTS(SELECT 1 FROM github_project_state WHERE repository=? AND revision=? AND epoch=?)",
			)
			.bind(repo.id, scan.id, updated.complete ? 1 : 0, repo.id, revision, epoch),
		db
			.prepare(
				"UPDATE github_project_state SET snapshot=?,scan=?,observedAt=?,invalidated=?,revision=revision+1 WHERE repository=? AND revision=? AND epoch=?",
			)
			.bind(JSON.stringify(snapshot), JSON.stringify(updated), now, 0, repo.id, revision, epoch),
	];
	const result = await db.batch(statements);
	if (result.at(-1)!.meta.changes !== 1) throw new GitHubError("Project changed during refresh; refresh again");
}

export async function readState(db: D1Database, repo: GitHubRepository): Promise<ProjectState | null> {
	const records = await db.batch([
		db
			.prepare(
				"SELECT snapshot,scan,observedAt,revision,invalidated FROM github_project_state WHERE repository=?",
			)
			.bind(repo.id),
		db
			.prepare(
				"SELECT kind,id,number,firstSeen,changedAt,data,missing FROM github_project_activity WHERE repository=? ORDER BY firstSeen DESC,id DESC",
			)
			.bind(repo.id),
	]);
	const row = records[0]!.results[0] as
		| { snapshot: string | null; scan: string | null; observedAt: number; revision: number; invalidated: number }
		| undefined;
	if (!row?.snapshot || !row.scan) return null;
	const snapshot: Snapshot = JSON.parse(row.snapshot);
	const scan: Scan = JSON.parse(row.scan);
	const rows = records[1]!.results as (Omit<Activity, "data"> & { data: string | null })[];
	const activity: Activity[] = rows.map((item) => ({ ...item, data: item.data ? JSON.parse(item.data) : null }));
	const paths = new Set(snapshot.documents.map((d) => d.path));
	const changes = activity
		.filter((item) => item.kind === "pull" && !item.missing && item.data?.state === "OPEN")
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
	const claims = scan.claims.map((ref) => associatedQuest(ref, paths)).filter((q): q is string => q !== null);
	const complete = scan.complete && row.invalidated === 0;
	const occupied = new Set([...claims, ...changes.map((c) => c.quest)]);
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
	};
	return {
		project,
		activity,
		claims,
		available: complete
			? ready(snapshot.documents.map((d) => parse(d.path, d.content))).filter((path) => !occupied.has(path))
			: [],
		complete,
		observedAt: row.observedAt,
		revision: row.revision,
	};
}
