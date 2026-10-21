// The decision inbox: everything on a maintainer's projects that waits on them,
// one item per job target. An issue, its planning job, and that job's questions
// are one item, so updates, reconnects, and duplicate webhooks coalesce instead
// of adding prompts. Agent text and GitHub data stay untrusted display data.

import { parse } from "quest/core";
import { encodePath } from "../board/model";
import { GitHubError, type Enrollment, GitHubService, NotMaintainer } from "../github/service";
import { type Activity, type ProjectState, readState } from "../github/state";
import { type Prompt, parsePrompt } from "../jobs/prompt";
import { hub } from "../jobs/routes";
import * as store from "../jobs/store";
import { projectURL } from "../projects";

export type JobView = NonNullable<Awaited<ReturnType<typeof store.readJob>>>;
export type QuestionView = JobView["questions"][number];
/** A maintainer's own read state for one item. */
export type Read = { repository: number; item: string; seen: string | null; skipped: string | null };

/**
 * What the item asks of the maintainer: answer an agent, pick an account for
 * a limited job, retry a failure, or start work on an issue, PR, or ready
 * quest. `null` is work in progress, which only informs.
 */
export type Need = "answer" | "account" | "retry" | "start";
export type Kind = "issue" | "pull" | "quest" | "plan" | "devshell";

export type Item = {
	project: Enrollment;
	/** The job target the item coalesces on, such as `issues/1` or `quest/a.md`. */
	target: string;
	kind: Kind;
	title: string;
	href: string;
	activity: Activity | null;
	/** The target's latest job. */
	job: JobView | null;
	/** The job's open question, and its prompt when an agent asked it. */
	question: QuestionView | null;
	prompt: Prompt | null;
	need: Need | null;
	/** What the item currently shows; a newer version is unread again and undoes a skip. */
	version: string;
	unread: boolean;
	/** Skipped by the maintainer, or finished by its job, until the item changes. */
	skipped: boolean;
	at: number;
};

/** One project's place in the inbox, or why it is unavailable. */
export type ProjectView = { project: Enrollment; state: ProjectState | null; error: string | null };

// FNV-1a: a short, stable version for a quest's text.
function digest(text: string) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
	return (hash >>> 0).toString(16);
}

function kindOf(target: string): Kind {
	if (target.startsWith("issues/")) return "issue";
	if (target.startsWith("pulls/")) return "pull";
	if (target.startsWith("plans/")) return "plan";
	return target === "devshell" ? "devshell" : "quest";
}

/** A quest's page on the project's board: its path without `.md`, or its epic's directory. */
export function questHref(project: Enrollment, path: string) {
	return `${projectURL(project.owner, project.name)}/board/${encodePath(path.replace(/(\/README)?\.md$/, ""))}`;
}

export type Entity = Pick<Item, "kind" | "title" | "href" | "activity" | "version" | "at">;

/** The open issues, open pull requests, and ready quests a maintainer can act on, by job target. */
export function entities(project: Enrollment, state: ProjectState | null) {
	const found = new Map<string, Entity>();
	if (!state) return found;
	const web = `https://github.com/${project.owner}/${project.name}`;
	for (const activity of state.activity) {
		// A webhook's pointer has no data until a refresh reads it, but it is already news.
		if (activity.missing || (activity.data && activity.data.state !== "OPEN")) continue;
		const pull = activity.kind === "pull";
		found.set(`${pull ? "pulls" : "issues"}/${activity.number}`, {
			kind: activity.kind,
			title: activity.data?.title ?? `${pull ? "Pull request" : "Issue"} #${activity.number}`,
			href: `${web}/${pull ? "pull" : "issues"}/${activity.number}`,
			activity,
			version: String(activity.changedAt),
			at: activity.changedAt,
		});
	}
	for (const path of state.project.available ?? []) {
		const content = state.project.documents.find((d) => d.path === path)?.content ?? "";
		found.set(path, {
			kind: "quest",
			title: parse(path, content).title?.text ?? path,
			href: questHref(project, path),
			activity: null,
			version: digest(content),
			at: 0,
		});
	}
	return found;
}

function fallback(project: Enrollment, target: string): Entity {
	const web = `https://github.com/${project.owner}/${project.name}`;
	const kind = kindOf(target);
	const number = target.split("/")[1];
	const titles: Record<Kind, [string, string]> = {
		issue: [`Issue #${number}`, `${web}/issues/${number}`],
		pull: [`Pull request #${number}`, `${web}/pull/${number}`],
		plan: ["New plan", web],
		devshell: ["Add a flake devShell", web],
		quest: [target, questHref(project, target)],
	};
	const [title, href] = titles[kind];
	return { kind, title, href, activity: null, version: "", at: 0 };
}

/**
 * Build one project's items from its observed `found` entities, its latest
 * jobs, and the maintainer's read state.
 */
export function decisions(view: ProjectView, found: Map<string, Entity>, jobs: JobView[], reads: Read[]): Item[] {
	const { project } = view;
	const latest = new Map<string, JobView>();
	// Jobs arrive newest first.
	for (const job of jobs) if (!latest.has(job.target)) latest.set(job.target, job);
	const items: Item[] = [];
	for (const target of new Set([...found.keys(), ...latest.keys()])) {
		const entity = found.get(target);
		const job = latest.get(target) ?? null;
		// GitHub showed a change after the job ended, such as a new push or comment.
		const changed = !!entity && !!job && entity.at > job.updatedAt;
		let need: Need | null = null;
		let version = entity?.version ?? "";
		let question: QuestionView | null = null;
		let ended = false;
		if (job && (job.state === "queued" || job.state === "running")) version = `job:${job.id}`;
		else if (job?.state === "waiting") {
			question = job.questions.find((q) => q.attempt === job.attempt && q.answer === null) ?? null;
			if (question) need = question.kind === "account" ? "account" : "answer";
			version = `question:${question?.id}`;
		} else if (job?.state === "failed" && !changed) {
			need = "retry";
			version = `job:${job.id}`;
		} else if (entity) {
			// Starting new work on a paused project would be refused, so it is not offered.
			if (project.state !== "enabled") continue;
			need = "start";
			ended = !!job && !changed;
		} else continue;
		const read = reads.find((r) => r.repository === project.id && r.item === target);
		let prompt: Prompt | null = null;
		if (question?.kind === "agent")
			try {
				prompt = parsePrompt(question.prompt);
			} catch {}
		items.push({
			...(entity ?? fallback(project, target)),
			project,
			target,
			job,
			question,
			prompt,
			need,
			version,
			unread: need !== null && read?.seen !== version,
			skipped: need !== null && (ended || read?.skipped === version),
			at: question?.askedAt ?? (need === "retry" ? job!.updatedAt : (entity?.at ?? job?.updatedAt ?? 0)),
		});
	}
	return items;
}

// Agents blocked on an answer come first, then failures, then new PRs,
// issues, and ready quests: the loop of reviewing, planning, and spawning.
const order = (item: Item) =>
	item.need === "answer" || item.need === "account"
		? 0
		: item.need === "retry"
			? 1
			: ({ pull: 2, issue: 3, quest: 4, plan: 5, devshell: 5 } as const)[item.kind];

/** Sort the items: decisions in priority order, then work in progress, then what was set aside. */
export function arrange(items: Item[]) {
	const sorted = [...items].sort((a, b) => order(a) - order(b) || (order(a) === 0 ? a.at - b.at : b.at - a.at));
	return {
		decisions: sorted.filter((item) => item.need !== null && !item.skipped),
		working: sorted.filter((item) => item.need === null),
		skipped: sorted.filter((item) => item.skipped),
	};
}

export type Runners = Awaited<ReturnType<typeof store.listRunners>>;

/** Every project's items, from its observations, its jobs, and the maintainer's read state. */
async function collect(db: D1Database, user: string, views: ProjectView[]) {
	const found = views.map((view) => entities(view.project, view.state));
	const [reads, jobs] = await Promise.all([
		db.prepare("SELECT repository,item,seen,skipped FROM inbox_items WHERE user=?").bind(user).all<Read>(),
		Promise.all(views.map((view, i) => store.listInboxJobs(db, view.project.id, [...found[i]!.keys()]))),
	]);
	return views.flatMap((view, i) => decisions(view, found[i]!, jobs[i]!, reads.results));
}

/**
 * How many decisions are new to a maintainer, for the nav and the app icon
 * badge. It reads only stored observations, without rechecking GitHub
 * authority on every page, so it reveals a count and nothing else.
 */
export async function unread(env: Env, user: string) {
	const projects = await new GitHubService(env).projects(user);
	const views = await Promise.all(
		projects.map(async (project) => ({ project, state: await readState(env.DB, project), error: null })),
	);
	return (await collect(env.DB, user, views)).filter((item) => item.need !== null && !item.skipped && item.unread)
		.length;
}

/** What a notification calls an item: its issue, pull request, or quest title, as the inbox shows it. */
export async function title(db: D1Database, project: Enrollment, target: string) {
	const state = await readState(db, project);
	return (entities(project, state).get(target) ?? fallback(project, target)).title;
}

/**
 * Load the inbox across the projects the user is a member of. Every project
 * rechecks current GitHub authority. A denied check ends the membership and
 * hides the project; one that cannot complete is reported, not hidden.
 */
export async function load(env: Env, user: string) {
	const github = new GitHubService(env);
	const views = await Promise.all(
		(await github.projects(user)).map(async (project): Promise<ProjectView | null> => {
			try {
				return { project, state: await github.projectState(project, user), error: null };
			} catch (error) {
				if (error instanceof NotMaintainer) return null;
				if (!(error instanceof GitHubError)) throw error;
				return { project, state: null, error: error.message };
			}
		}),
	);
	const projects = views.filter((view) => view !== null);
	const items = await collect(
		env.DB,
		user,
		projects.filter((view) => !view.error),
	);
	// Jobs run on their requester's runners, so presence comes from each requester's hub.
	const actors = [...new Set(items.flatMap((item) => (item.job ? [item.job.actor] : [])))];
	const runners = new Map<string, Runners>(
		await Promise.all(
			actors.map(
				async (actor) =>
					[actor, await store.listRunners(env.DB, actor, new Set(await hub(env, actor).online()))] as const,
			),
		),
	);
	return { projects, items, runners };
}

/** Record that the maintainer saw an item as it is now. */
export function markSeen(db: D1Database, user: string, item: Item) {
	return db
		.prepare(
			"INSERT INTO inbox_items(user,repository,item,seen) VALUES(?,?,?,?) ON CONFLICT(user,repository,item) DO UPDATE SET seen=excluded.seen",
		)
		.bind(user, item.project.id, item.target, item.version)
		.run();
}

/** Set an item aside until it changes. */
export function skip(db: D1Database, user: string, repository: number, item: string, version: string) {
	return db
		.prepare(
			"INSERT INTO inbox_items(user,repository,item,skipped) VALUES(?,?,?,?) ON CONFLICT(user,repository,item) DO UPDATE SET skipped=excluded.skipped",
		)
		.bind(user, repository, item, version)
		.run();
}
