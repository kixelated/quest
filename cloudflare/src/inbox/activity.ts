// Agent cards: what each job on a maintainer's projects is doing, told by the
// agent's own checkpoint summaries. Summaries are untrusted agent text, shown
// as escaped text and never read as an answer. Raw output is not part of a
// card; it loads behind a per-job disclosure that rechecks maintainer authority.

import { parse } from "quest/core";
import type { Enrollment } from "../github/service";
import { type Item, type JobView, type ProjectView, type Runners, entities, fallback } from "./model";

/** How long a working job may go without a summary before its card says so, rather than guessing. */
export const QUIET = 15 * 60_000;

/**
 * Where a job stands: waiting for a runner, working, on a runner that went
 * offline, waiting on a maintainer's answer, paused on a limited account, or
 * ended with the pull request it delivered still open, either finished or stopped.
 */
export type Phase = "queued" | "working" | "offline" | "waiting" | "limited" | "pull" | "stopped";

export const PHASES: Record<Phase, string> = {
	queued: "Queued",
	working: "Working",
	offline: "Runner offline",
	waiting: "Waiting on you",
	limited: "Account limited",
	pull: "PR open",
	stopped: "Stopped",
};

export type Card = {
	project: Enrollment;
	job: JobView;
	/** The target the job works on: its issue, pull request, or quest. */
	title: string;
	href: string;
	/** The quest the job works on, which the quest map highlights. */
	quest: string | null;
	phase: Phase;
	runner: string | null;
	account: string | null;
	/** The pull request the job delivered. */
	pull: { number: number; href: string } | null;
	/** When the agent last wrote a summary, or when the job was requested. */
	at: number;
	/** A working job silent for longer than `QUIET`. */
	quiet: boolean;
	/** The inbox item for the job's target, where its thread and stop control live. */
	item: Item | null;
};

export function phase(job: JobView, runners: Runners): Phase {
	if (job.state === "queued") return "queued";
	if (job.state === "running") {
		const runner = runners.find((r) => r.id === job.runner);
		return job.lease !== null || !runner?.online ? "offline" : "working";
	}
	if (job.state === "waiting") {
		const question = job.questions.find((q) => q.attempt === job.attempt && q.approvedAt === null);
		return question?.kind === "account" && question.answer === null ? "limited" : "waiting";
	}
	return job.state === "completed" ? "pull" : "stopped";
}

// Cards that wait on a maintainer come first, then trouble, then work under way.
const ORDER: Phase[] = ["waiting", "limited", "offline", "working", "queued", "stopped", "pull"];

/** The cards for each project's jobs, with `items` from the same inbox load. */
export function cards(
	views: ProjectView[],
	jobs: JobView[][],
	runners: Map<string, Runners>,
	items: Item[],
	now: number,
): Card[] {
	return views
		.flatMap((view, i) => {
			const { project, state } = view;
			const found = entities(project, state);
			const web = `https://github.com/${project.owner}/${project.name}`;
			return jobs[i]!.map((job): Card => {
				const own = runners.get(job.actor) ?? [];
				const runner = own.find((r) => r.id === job.runner);
				const entity = found.get(job.target) ?? fallback(project, job.target);
				const kind = entity.kind;
				// A pull request on a quest's branch works on that quest, so the map keeps it highlighted.
				const number = kind === "pull" ? Number(job.target.split("/")[1]) : null;
				const quest =
					kind === "quest"
						? job.target
						: (state?.project.changes.find((change) => change.number === number)?.quest ?? null);
				// A claimed quest is no longer an observed entity, so its title comes from the tree.
				const document = kind === "quest" ? state?.project.documents.find((d) => d.path === quest) : undefined;
				const summaries = job.events.filter((e) => e.kind === "summary" || e.kind === "result");
				const at = summaries.at(-1)?.at ?? job.createdAt;
				const current = phase(job, own);
				return {
					project,
					job,
					title: document ? (parse(document.path, document.content).title?.text ?? quest!) : entity.title,
					href: entity.href,
					quest,
					phase: current,
					runner: runner?.name ?? null,
					account: runner?.accounts.find((a) => a.id === job.account)?.label ?? null,
					pull: job.pull === null ? null : { number: job.pull, href: `${web}/pull/${job.pull}` },
					at,
					quiet: current === "working" && now - at > QUIET,
					item: items.find((it) => it.project.id === project.id && it.target === job.target) ?? null,
				};
			});
		})
		.sort((a, b) => ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase) || b.at - a.at);
}

/** How long ago `at` was, roughly: just now, minutes, hours, then days. */
export function ago(now: number, at: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes === 0) return "just now";
	const [count, unit] =
		minutes < 60
			? [minutes, "minute"]
			: minutes < 48 * 60
				? [Math.round(minutes / 60), "hour"]
				: [Math.round(minutes / 1440), "day"];
	return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** The quest map's highlights: what the agent on each quest is doing, by the quest's path. */
export function highlights(list: Card[]) {
	return new Map(list.flatMap((card) => (card.quest ? [[card.quest, PHASES[card.phase]] as const] : [])));
}
