// A signed-in maintainer of an enrolled project with complete observations,
// and a mocked GitHub that answers the requests authority checks make.
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { app } from "../src/index";
import { identity, oauth } from "./login-fixtures";

const db = env.DB;
export const commit = "a".repeat(40);
export const head = "d".repeat(40);
export const documents = [
	{
		path: "quest/README.md",
		content: "# Project\n\n## Goal\n\nBuild it.\n\n## Required\n\n- [First](/quest/first.md)\n",
	},
	{ path: "quest/first.md", content: "# [S] First\n\n## Goal\n\nBuild first.\n" },
];

export async function project(id: number, owner: string, state: "enabled" | "paused" = "enabled") {
	await db
		.prepare(
			"INSERT INTO github_projects(id,owner,name,installation,state,enrolledBy,updatedAt) VALUES(?,'upstream','project',5,?,?,0) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
		)
		.bind(id, state, owner)
		.run();
}

export const pull = {
	databaseId: "21",
	number: 2,
	title: "Fix",
	state: "OPEN",
	updatedAt: "2026-10-16T00:00:00Z",
	author: null,
	comments: { totalCount: 0 },
	isDraft: false,
	reviewDecision: null,
	commits: { nodes: [{ commit: { oid: head, statusCheckRollup: { state: "SUCCESS" } } }] },
	headRefName: "contributor/fix",
	headRefOid: head,
};
export const issue = {
	databaseId: "11",
	number: 1,
	title: "Idea",
	state: "OPEN",
	updatedAt: "2026-10-16T00:00:00Z",
	author: { login: "reporter" },
	comments: { totalCount: 0 },
};

/**
 * Sign in a GitHub user, enroll project 10 for them with an open issue #1 and
 * pull request #2, and mock GitHub. `github` changes what the mock reports, and
 * `mock` reinstalls it after another sign-in replaces it.
 */
export async function maintainerOf() {
	const github = { flake: true, pullFlake: true, role: "maintain" };
	const who = identity("github");
	const cookie = (await oauth(who)).session!;
	const user = (await db
		.prepare("SELECT userId FROM account WHERE providerId='github' AND accountId=?")
		.bind(who.id)
		.first<{ userId: string }>())!.userId;
	await project(10, user);
	const snapshot = { commit, date: "2026-10-16", documents, completed: [] };
	const scan = { id: "scan", issues: false, pulls: false, refs: false, claims: [], complete: true };
	await db.batch([
		db
			.prepare(
				"INSERT INTO github_project_state(repository,epoch,snapshot,scan,observedAt) VALUES(10,'e',?,?,0) ON CONFLICT(repository) DO UPDATE SET snapshot=excluded.snapshot,scan=excluded.scan,invalidated=0",
			)
			.bind(JSON.stringify(snapshot), JSON.stringify(scan)),
		db
			.prepare(
				"INSERT INTO github_project_activity(repository,kind,id,number,firstSeen,changedAt,data,seenIn) VALUES(10,'pull','21',2,0,0,?,'scan'),(10,'issue','11',1,0,0,?,'scan')",
			)
			.bind(JSON.stringify(pull), JSON.stringify(issue)),
	]);
	const mock = async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		const path = url.pathname;
		if (path.endsWith("/installation"))
			return Response.json({
				id: 5,
				app_id: 123,
				suspended_at: null,
				permissions: { metadata: "read", contents: "read" },
			});
		if (path.endsWith("/access_tokens")) return Response.json({ token: "installation-token" });
		if (path === "/installation/token") return new Response(null, { status: 204 });
		if (path === "/repos/upstream/project")
			return Response.json({
				id: 10,
				name: "project",
				owner: { login: "upstream" },
				private: false,
				visibility: "public",
				default_branch: "trunk",
				archived: false,
				disabled: false,
			});
		if (path.startsWith("/user/")) {
			const id = path.split("/").at(-1)!;
			return Response.json({ id: Number(id), login: `person${id}` });
		}
		// Only the signed-in maintainer holds the maintain role; anyone else may read.
		const permission = path.match(/\/collaborators\/person(\d+)\/permission$/);
		if (permission)
			return Response.json(
				permission[1] === who.id
					? { user: { id: Number(who.id) }, permission: "write", role_name: github.role }
					: { user: { id: Number(permission[1]) }, permission: "read", role_name: "read" },
			);
		const ref = url.searchParams.get("ref");
		if (path === "/repos/upstream/project/contents/flake.nix" && (ref === commit || ref === head))
			return (ref === commit ? github.flake : github.pullFlake)
				? Response.json({ type: "file" })
				: new Response(null, { status: 404 });
		throw new Error(`Unexpected GitHub request ${path}`);
	};
	vi.spyOn(globalThis, "fetch").mockImplementation(mock);
	return { user, cookie, github, mock };
}

/** Deliver a signed GitHub webhook. */
export async function delivery(
	event: string,
	payload: unknown,
	id = crypto.randomUUID(),
	changes: Record<string, string> = {},
) {
	const body = typeof payload === "string" ? payload : JSON.stringify(payload);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const signature = "sha256=" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
	return app.request(
		"http://localhost:8787/webhooks/github",
		{
			method: "POST",
			headers: { "X-GitHub-Event": event, "X-GitHub-Delivery": id, "X-Hub-Signature-256": signature, ...changes },
			body,
		},
		env,
	);
}
