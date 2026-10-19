// Publishing a job's work as the GitHub App. A runner sends file changes as
// data; the service checks them against the job's workflow, commits them to
// the job's one branch, and opens or updates its pull request. Nothing a runner
// sends is executed, and runners never receive GitHub credentials.
import { isQuest } from "quest/core";
import { type Branch, type Change, GitHubService, PublicationBlocked, type GitHubRepository } from "../github/service";
import { id, text } from "./protocol";
import * as store from "./store";
import { JobError, type Runner, type Workflow } from "./store";

/** Bounds one request's GitHub writes: inline text costs no extra request, other files one each. */
export const LIMITS = { changes: 500, bytes: 16 * 1024 * 1024, request: 24 * 1024 * 1024 };

export type Publication = {
	job: string;
	attempt: number;
	/** The commit the changes build on: the job's branch head, or null before the branch exists. */
	head: string | null;
	/** The agent session to resume if the publication needs a decision. */
	session: string | null;
	message: string | null;
	changes: Change[];
	pull: { title: string; body: string; draft: boolean } | null;
};

/** Whether `path` names a file inside a work tree, never Git's own directory. */
export function validPath(path: string) {
	return (
		path.length <= 1024 &&
		!/[\x00-\x1f\x7f\\]/.test(path) &&
		path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git")
	);
}

/**
 * Why `workflow` may not publish `path`, or null when it may. A refusal
 * becomes a maintainer decision rather than silently dropping the change.
 */
export function refusal(workflow: Workflow, path: string): string | null {
	if (path === ".github/workflows" || path.startsWith(".github/workflows/"))
		return "Changing GitHub Actions workflows needs the workflows permission, which the App does not request";
	if (workflow === "bootstrap" && path !== "flake.nix" && path !== "flake.lock")
		return "A devShell bootstrap publishes only flake.nix and flake.lock";
	if (workflow === "plan" && !(path.startsWith("quest/") && isQuest(path)))
		return "Planning publishes only quest files";
	return null;
}

function base64(value: string) {
	if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new JobError("Invalid base64 content");
	return new Uint8Array(Buffer.from(value, "base64"));
}

/** Parse a runner's publication request. Every field is untrusted input. */
export function parsePublication(body: Record<string, unknown>): Publication {
	const job = id(body.job);
	const attempt = body.attempt;
	if (!job || typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1)
		throw new JobError("Job and attempt required");
	if (body.head !== null && !(typeof body.head === "string" && /^[a-f0-9]{40}$/.test(body.head)))
		throw new JobError("The commit the changes build on is required, or null for a new branch");
	const session = body.session === undefined ? null : text(body.session, 200);
	if (body.session !== undefined && !session) throw new JobError("Invalid session");
	const list = body.changes ?? [];
	if (!Array.isArray(list) || list.length > LIMITS.changes)
		throw new JobError(`At most ${LIMITS.changes} changes per publication`);
	let bytes = 0;
	const changes = list.map((item: Record<string, unknown> | null): Change => {
		const path = item?.path;
		if (typeof path !== "string" || !validPath(path)) throw new JobError("Invalid change path");
		const { executable, symlink } = item!;
		if (executable !== undefined && typeof executable !== "boolean") throw new JobError("Invalid executable flag");
		if (symlink !== undefined && typeof symlink !== "boolean") throw new JobError("Invalid symlink flag");
		if (executable && symlink) throw new JobError("A symlink cannot be executable");
		if (item!.content !== null && typeof item!.content !== "string")
			throw new JobError("Change content must be base64, or null to delete");
		const content = item!.content === null ? null : base64(item!.content as string);
		bytes += content?.length ?? 0;
		// A symlink's content is its target. Submodules have no representation here.
		return { path, content, mode: symlink ? "120000" : executable ? "100755" : "100644" };
	});
	if (bytes > LIMITS.bytes) throw new JobError("Publication too large");
	if (new Set(changes.map((change) => change.path)).size !== changes.length)
		throw new JobError("Duplicate change path");
	const message = changes.length ? text(body.message, 64 * 1024) : null;
	if (changes.length && !message) throw new JobError("Commit message required");
	let pull: Publication["pull"] = null;
	if (body.pull !== undefined) {
		const input = body.pull as Record<string, unknown> | null;
		const title = text(input?.title, 256);
		const description = input?.body;
		if (
			!title ||
			typeof description !== "string" ||
			description.length > 60_000 ||
			(input!.draft !== undefined && typeof input!.draft !== "boolean")
		)
			throw new JobError("Pull request title and body required");
		pull = { title, body: description, draft: input!.draft !== false };
	}
	if (!changes.length && !pull) throw new JobError("Nothing to publish");
	return { job, attempt, head: body.head as string | null, session, message, changes, pull };
}

type Decision = { decision: string; cancel: boolean };
type Published = { head: string | null; pull?: { number: number; url: string; draft: boolean } };

/** Pause the attempt on a decision the maintainer must make before this can publish. */
async function decide(db: D1Database, runner: Runner, input: Publication, prompt: unknown): Promise<Decision> {
	const { question, cancel } = await store.ask(
		db,
		runner,
		input.job,
		input.attempt,
		{
			kind: "publication",
			summary: "Publishing this work needs a maintainer's decision",
			session: input.session,
			prompt,
		},
		Date.now(),
	);
	return { decision: question, cancel };
}

/**
 * The job's branch head, unless the branch is not where the job left it. A
 * commit whose outcome went unrecorded is adopted first, so an interrupted
 * publication is never mistaken for someone else's write.
 */
async function verify(db: D1Database, job: store.Publishing, input: Publication, branch: Branch) {
	const current = await branch.head();
	let head = job.head;
	if (current !== head && job.pending && current === job.pending) {
		await store.adopt(db, job.id, head, job.pending, Date.now());
		head = current;
	}
	if (current !== head)
		throw new PublicationBlocked(
			head === null
				? `${branch.repository.owner}/${branch.repository.name} already has the branch ${job.branch} from earlier work. Delete it on GitHub to start over.`
				: `The branch ${job.branch} changed outside this job.`,
		);
	if (input.head !== head) throw new JobError(`The job's branch is at ${head ?? "no commit yet"}; continue from it`);
	return head;
}

/** Commit the changes on the verified `head` of the job's branch. */
async function commit(
	db: D1Database,
	runner: Runner,
	job: store.Publishing,
	input: Publication,
	branch: Branch,
	head: string | null,
): Promise<string> {
	const next = await branch.commit(head ?? job.revision, input.changes, input.message!);
	// Check the fence again immediately before the write that makes the commit visible.
	await store.claim(db, runner, job.id, job.attempt, head, next, Date.now());
	// A failure here leaves the claim pending; the next publication finds out whether it landed.
	const landed = await branch.move(head, next);
	await store.settle(db, job.id, next, landed, Date.now());
	if (!landed) throw new JobError("The job's branch moved; continue from its new head");
	return next;
}

/** Publish a running attempt's changes and pull request, or pause it on a decision. */
export async function publish(env: Env, runner: Runner, input: Publication): Promise<Published | Decision> {
	const db = env.DB;
	const job = await store.publishing(db, runner, input.job, input.attempt);
	if (input.pull && job.workflow === "iterate")
		throw new JobError("An iteration updates its pull request's head and opens no pull request");
	const refused = input.changes.flatMap((change) => {
		const reason = refusal(job.workflow, change.path);
		return reason ? [{ path: change.path, reason }] : [];
	});
	if (refused.length) return decide(db, runner, input, { type: "publication", refused });
	const github = new GitHubService(env);
	const upstream: GitHubRepository = { owner: job.owner, name: job.name, id: job.repository };
	let head: string | null;
	try {
		// A pull request opens from the branch, so a delivery alone still checks where it is.
		head = await github.contribute(upstream, job.actor, job, async (branch) => {
			const head = await verify(db, job, input, branch);
			return input.changes.length ? commit(db, runner, job, input, branch, head) : head;
		});
	} catch (error) {
		if (error instanceof PublicationBlocked)
			return decide(db, runner, input, { type: "publication", blocked: error.message });
		throw error;
	}
	if (!input.pull) return { head };
	if (!head) throw new JobError("Publish the job's changes before opening its pull request");
	// The attempt may have ended, or been asked to stop, while the branch was written.
	const current = await store.publishing(db, runner, input.job, input.attempt);
	// Planning PRs always await maintainer review; so does work that was asked to stop.
	const draft = input.pull.draft || current.workflow === "plan" || current.cancel === 1;
	const pull = await github.deliver(upstream, current.actor, current, { ...input.pull, draft });
	await store.delivered(db, job.id, pull.number);
	return { head, pull };
}
