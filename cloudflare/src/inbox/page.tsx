import { type Pull, startable } from "../github/state";
import { type Prompt, parsePrompt } from "../jobs/prompt";
import { type Done, PUBLICATION_REPLY, inboxURL } from "../jobs/routes";
import { Marker, Notifications } from "../layout";
import { projectURL } from "../projects";
import type { Item, ProjectView, QuestionView, Runners } from "./model";

// The decision inbox, phone first: one active decision thread, then what is
// up next, what is in progress, and the projects as secondary views. Plain
// forms post every action, so it works by keyboard and without JavaScript.

export type InboxProps = {
	user: string;
	projects: ProjectView[];
	active: Item | null;
	/** The requested item is gone, such as a question another maintainer answered. */
	missing: boolean;
	/** What the previous form recorded, from the redirect's query. */
	done: string | undefined;
	decisions: Item[];
	working: Item[];
	skipped: Item[];
	runners: Map<string, Runners>;
	/** The VAPID public key, or null where notifications are not configured. */
	notifications: string | null;
};

const recorded: Record<Done, string> = {
	answer: "Answer recorded.",
	approve: "Answer approved.",
	start: "Job requested.",
	stop: "Stop requested.",
	skip: "Skipped until it changes.",
	merge: "Pull request merged.",
};

const kinds = { pull: "Pull request", issue: "Issue", quest: "Ready quest", plan: "Plan", devshell: "Bootstrap" };

function needLabel(item: Item) {
	if (item.need === "answer") {
		if (item.question?.kind === "publication") return "Publishing needs your decision";
		return item.prompt?.kind === "permission" ? "Tool permission request" : "Waiting for your decision";
	}
	if (item.need === "account") return "Account limited";
	if (item.need === "approve") return "Answer to approve";
	if (item.need === "retry") return "Failed";
	if (item.need === "start")
		return item.skipped && item.job ? `${kinds[item.kind]} · job ${item.job.state}` : kinds[item.kind];
	if (!item.job) return "Claimed draft";
	if (item.job.state === "waiting") return "Awaiting approval";
	return item.job.state === "queued" ? "Queued" : "Working";
}

/** Plainly what the item's job is doing, with the next useful action where there is one. */
function progress(item: Item, runners: Runners, user: string) {
	const job = item.job;
	if (!job && item.need === null)
		return "Its starter holds this draft. It waits on you once they mark it ready or hand back decisions.";
	if (!job || item.need === "start") return null;
	const whose = job.actor === user ? "your" : "the requester's";
	if (job.state === "queued")
		return runners.some((r) => r.online)
			? "Queued for the next free runner."
			: `Waiting for a runner: none of ${whose} runners are online. Run quest runner on one of them.`;
	if (job.state === "running") {
		if (job.cancel) return "Stopping as requested.";
		const runner = runners.find((r) => r.id === job.runner);
		if (job.lease !== null || !runner?.online)
			return "Runner offline. The job moves to another runner if it stays away for two minutes.";
		return `Working on ${runner.name}.`;
	}
	if (item.need === "account")
		return "The job's account hit its limit. Choose an account to continue; kix never switches accounts on its own.";
	if (item.need === "retry") return "The job failed. Its summary says what happened.";
	if (job.state === "waiting" && item.need === null)
		return "Answered. The job resumes once its requester approves the answer, since it runs on their machine.";
	return null;
}

// GitHub's enums, such as CHANGES_REQUESTED, read as plain words.
const words = (value: string) => value.toLowerCase().replaceAll("_", " ");

function Context(props: { item: Item }) {
	const data = props.item.activity?.data;
	if (!data) return null;
	const pull = props.item.kind === "pull" ? (data as Pull) : null;
	return (
		<p class="entry-meta decision-meta">
			<span>{data.author ? `By ${data.author.login}` : "By a GitHub user"}</span>
			<span>
				{data.comments.totalCount} comment{data.comments.totalCount === 1 ? "" : "s"}
			</span>
			{pull && (
				<>
					{pull.isDraft && <span>Draft</span>}
					<span>Checks: {words(pull.commits.nodes.at(-1)?.commit.statusCheckRollup?.state ?? "none")}</span>
					<span>Review: {pull.reviewDecision ? words(pull.reviewDecision) : "none yet"}</span>
				</>
			)}
		</p>
	);
}

function parsed(question: QuestionView): Prompt | null {
	try {
		return parsePrompt(question.prompt);
	} catch {
		return null;
	}
}

/** One submitted answer, as escaped text. */
function Reply(props: { question: QuestionView }) {
	const q = props.question;
	if (q.kind === "account") return <>Chose an account to continue on.</>;
	if (q.kind === "publication") return <>{typeof q.answer === "string" ? q.answer : ""}</>;
	const prompt = parsed(q);
	const replies = (q.answer as { answers?: { choices: string[]; text?: string }[] }).answers ?? [];
	return (
		<>
			{prompt?.questions.map((ask, i) => (
				<p>
					<span class="muted">{ask.question}</span>
					<br />
					{[...(replies[i]?.choices ?? []), ...(replies[i]?.text ? [replies[i]!.text] : [])].join(" · ")}
				</p>
			))}
		</>
	);
}

/** The thread's approved answers, kept across refreshes and reconnects. */
function History(props: { item: Item }) {
	const answered = props.item.job?.questions.filter((q) => q.approvedAt !== null) ?? [];
	if (!answered.length) return null;
	return (
		<details class="history">
			<summary>Earlier answers ({answered.length})</summary>
			<ol>
				{answered.map((q) => (
					<li>
						<Reply question={q} />
					</li>
				))}
			</ol>
		</details>
	);
}

/**
 * Another maintainer's answer to the requester's job. Until the job sandbox
 * ships, the requester's runner acts on it only once they approve it.
 */
function Approval(props: { item: Item }) {
	const { item } = props;
	return (
		<section class="summary">
			<h3>Another maintainer answered</h3>
			<Reply question={item.question!} />
			<p class="note-small muted">
				The agent acts on this answer with your machine and credentials, so the job resumes only once you
				approve it. You can answer differently below instead.
			</p>
			<form method="post" action={`${jobsURL(item)}/${item.job!.id}/approve`} class="decision-form">
				<input type="hidden" name="question" value={item.question!.id} />
				<button class="button primary">Approve and resume</button>
			</form>
		</section>
	);
}

function jobsURL(item: Item) {
	return `${projectURL(item.project.owner, item.project.name)}/jobs`;
}

function AgentForm(props: { item: Item; prompt: Prompt }) {
	const { item, prompt } = props;
	return (
		<form method="post" action={`${jobsURL(item)}/${item.job!.id}/answer`} class="decision-form">
			<input type="hidden" name="question" value={item.question!.id} />
			{prompt.kind === "permission" && (
				<p class="note-small muted">
					The agent's tool asks for permission. This is not a product decision about the work.
				</p>
			)}
			{prompt.questions.map((ask, i) => (
				<fieldset class="ask">
					<legend>
						{ask.header && <span class="ql-eyebrow">{ask.header}</span>}
						{ask.question}
					</legend>
					{ask.options.map((option, j) => (
						<label class="choice" for={`q${i}-${j}`}>
							<input
								id={`q${i}-${j}`}
								type={ask.multiple ? "checkbox" : "radio"}
								name={`q${i}`}
								value={option.label}
							/>
							<span>
								<strong>{option.label}</strong>
								{option.recommended && <span class="tag">Recommended</span>}
								{option.description && <span class="choice-why">{option.description}</span>}
							</span>
						</label>
					))}
					<label class="free" for={`q${i}-text`}>
						{ask.options.length ? "Or answer in your own words" : "Your answer"}
					</label>
					<textarea id={`q${i}-text`} name={`q${i}-text`} rows={2} maxlength={4000} />
				</fieldset>
			))}
			<button class="button primary">{prompt.questions.length > 1 ? "Submit answers" : "Submit answer"}</button>
		</form>
	);
}

/** A publication decision's prompt. kix wrote it, but its paths came from the runner. */
function publication(question: QuestionView) {
	const prompt = question.prompt as { refused?: unknown; blocked?: unknown } | null;
	return {
		refused: Array.isArray(prompt?.refused) ? (prompt.refused as { path: string; reason: string }[]) : [],
		blocked: typeof prompt?.blocked === "string" ? prompt.blocked : null,
	};
}

/** Work kix would not publish as is; the maintainer's reply resumes the agent's session. */
function PublicationForm(props: { item: Item }) {
	const { item } = props;
	const { refused, blocked } = publication(item.question!);
	return (
		<form method="post" action={`${jobsURL(item)}/${item.job!.id}/answer`} class="decision-form">
			<input type="hidden" name="question" value={item.question!.id} />
			<fieldset class="ask">
				<legend>The agent's work was not published</legend>
				{blocked && <p>{blocked}</p>}
				{refused.length > 0 && (
					<ul>
						{refused.map((change) => (
							<li>
								<code>{change.path}</code>: {change.reason}
							</li>
						))}
					</ul>
				)}
				<label class="free" for="publication-text">
					Tell the agent how to continue
				</label>
				<textarea id="publication-text" name="text" rows={3} maxlength={PUBLICATION_REPLY} required />
			</fieldset>
			<button class="button primary">Send to the agent</button>
		</form>
	);
}

function AccountForm(props: { item: Item; runners: Runners }) {
	const { item } = props;
	const job = item.job!;
	// Untrusted heads run only on Linux runners that build in a VM.
	const usable = props.runners.filter((r) => job.trusted || (r.platform === "linux" && r.vm));
	const choices = usable.flatMap((runner) => runner.accounts.map((account) => ({ runner, account })));
	if (!choices.length)
		return (
			<p>
				No runner of the requester's has an account that can run this job. Add one with{" "}
				<code>quest runner</code>.
			</p>
		);
	return (
		<form method="post" action={`${jobsURL(item)}/${job.id}/answer`} class="decision-form">
			<input type="hidden" name="question" value={item.question!.id} />
			<fieldset class="ask">
				<legend>Continue on which account?</legend>
				{choices.map(({ runner, account }, i) => (
					<label class="choice" for={`account-${i}`}>
						<input
							id={`account-${i}`}
							type="radio"
							name="account"
							value={`${runner.id}:${account.id}`}
							required
						/>
						<span>
							<strong>{account.label}</strong>
							<span class="choice-why">
								{runner.name}
								{runner.online ? "" : " (offline)"}
								{account.limited ? " · limited; choosing it again retries" : ""}
							</span>
						</span>
					</label>
				))}
			</fieldset>
			<p class="note-small muted">A new session continues from the job's summaries.</p>
			<button class="button primary">Continue</button>
		</form>
	);
}

/** Why new work cannot start from here yet, and how to fix it; `null` when it can. */
function blocked(item: Item, view: ProjectView | undefined) {
	if (item.project.state !== "enabled") return "Contributions are paused for this project.";
	const state = view?.state;
	// Webhooks reread the project in the background; a failed read says why.
	const failed = state?.failure ? `The background read failed: ${state.failure}. ` : "";
	if (!state?.project.available)
		return `${failed || "GitHub reported changes. "}Refresh to start new work from current state.`;
	// A retry continues its failed job's pull request, so that claim does not block it.
	const retry = item.need === "retry" ? (item.job?.pull ?? null) : null;
	if (item.kind === "quest" && !startable(state, item.target, retry))
		return "This quest is no longer ready to start, such as when it is claimed or removed.";
	if ((item.kind === "issue" || item.kind === "pull") && !item.activity?.data)
		return `${failed}Refresh to read this from GitHub.`;
	return null;
}

/** The workflow a new job runs for the item, bound to the revision on screen. */
function work(item: Item, view: ProjectView) {
	const commit = view.state!.project.commit;
	if (item.kind === "pull")
		return {
			workflow: "iterate",
			target: item.target,
			revision: (item.activity!.data as Pull).headRefOid,
			label: "Iterate on this PR",
		};
	if (item.kind === "issue")
		return { workflow: "plan", target: item.target, revision: commit, label: "Plan this issue" };
	// Only a failed interview is an item, so this retries it on the same target.
	if (item.kind === "plan") return { workflow: "plan", target: item.target, revision: commit, label: "Try again" };
	if (item.kind === "devshell") return { workflow: "bootstrap", revision: commit, label: "Add a devShell" };
	return { workflow: "start", target: item.target, revision: commit, label: "Start this quest" };
}

/**
 * The observed pull request when GitHub reports it can merge as is: no
 * conflicts, and its checks and branch rules satisfied. Anything else is
 * reviewed on GitHub or merged by a later merge job.
 */
function clean(item: Item) {
	const pull = item.kind === "pull" ? (item.activity?.data as Pull | null | undefined) : null;
	return pull?.state === "OPEN" && ["CLEAN", "HAS_HOOKS"].includes(pull.mergeStateStatus ?? "") ? pull : null;
}

function Refresh(props: { project: Item["project"] }) {
	return (
		<form method="post" action={`${projectURL(props.project.owner, props.project.name)}/refresh`}>
			<input type="hidden" name="next" value="inbox" />
			<button class="button quiet">Refresh from GitHub</button>
		</form>
	);
}

function Actions(props: { item: Item; view: ProjectView | undefined }) {
	const { item, view } = props;
	const base = projectURL(item.project.owner, item.project.name);
	const starts = item.need === "start" || item.need === "retry";
	const reason = starts ? blocked(item, view) : null;
	// Only an unblocked item has the observations its work is bound to.
	const job = starts && !reason ? work(item, view!) : null;
	// Only an idle item offers merge: no queued, running, or waiting job can still push to its head.
	const merge = starts && !reason ? clean(item) : null;
	const active = item.job && ["queued", "running", "waiting"].includes(item.job.state) && !item.job.cancel;
	return (
		<div class="decision-actions">
			{merge && (
				<form method="post" action={`${base}/pulls/${merge.number}/merge`}>
					<input type="hidden" name="head" value={merge.headRefOid} />
					<input type="hidden" name="version" value={item.version} />
					<button class="button primary">Merge this PR</button>
				</form>
			)}
			{reason ? (
				<>
					<p class="muted">{reason}</p>
					{item.project.state === "enabled" && <Refresh project={item.project} />}
				</>
			) : (
				job && (
					<form method="post" action={`${base}/jobs`}>
						<input type="hidden" name="workflow" value={job.workflow} />
						{job.target && <input type="hidden" name="target" value={job.target} />}
						<input type="hidden" name="revision" value={job.revision} />
						<button class={merge ? "button quiet" : "button primary"}>
							{item.need === "retry" ? "Try again" : job.label}
						</button>
					</form>
				)
			)}
			{item.kind === "pull" && (
				<a class="button quiet" href={item.href}>
					Review on GitHub
				</a>
			)}
			{(item.need === "start" || item.need === "retry") && !item.skipped && (
				<form method="post" action={`${base}/skip`}>
					<input type="hidden" name="item" value={item.target} />
					<input type="hidden" name="version" value={item.version} />
					<button class="button quiet">Skip until it changes</button>
				</form>
			)}
			{active && (
				<form method="post" action={`${base}/jobs/${item.job!.id}/cancel`}>
					<button class="button quiet">Stop this job</button>
				</form>
			)}
		</div>
	);
}

function Thread(props: { item: Item; view: ProjectView | undefined; runners: Runners; user: string }) {
	const { item, runners } = props;
	const status = progress(item, runners, props.user);
	return (
		<article class="ql-panel decision" aria-labelledby="decision-title">
			<p class="ql-eyebrow">
				{item.project.owner}/{item.project.name} · {needLabel(item)}
			</p>
			<h2 id="decision-title">
				<a href={item.href}>{item.title}</a>
			</h2>
			<Context item={item} />
			{status && <p role="status">{status}</p>}
			{item.job?.summary && (
				<section class="summary">
					<h3>Latest update from the agent</h3>
					<p>{item.job.summary}</p>
				</section>
			)}
			<History item={item} />
			{item.need === "approve" && <Approval item={item} />}
			{(item.need === "answer" || item.need === "account" || item.need === "approve") &&
				(item.question?.kind === "account" ? (
					<AccountForm item={item} runners={runners} />
				) : item.question?.kind === "publication" ? (
					<PublicationForm item={item} />
				) : item.prompt ? (
					<AgentForm item={item} prompt={item.prompt} />
				) : (
					<p role="alert">
						The agent's question could not be read. Stop the job or wait for the runner to ask again.
					</p>
				))}
			<Actions item={item} view={props.view} />
		</article>
	);
}

function Row(props: { item: Item; current: boolean }) {
	const { item } = props;
	return (
		<li class="entry">
			<Marker status={item.unread ? "available" : "pending"} />
			<a
				class="entry-title"
				href={inboxURL(item.project.id, item.target)}
				aria-current={props.current ? "true" : undefined}
			>
				{item.title}
			</a>
			<span class="entry-meta">
				{item.unread && <span class="tag">New</span>}
				<span>{needLabel(item)}</span>
				<span class="muted">
					{item.project.owner}/{item.project.name}
				</span>
			</span>
		</li>
	);
}

function List(props: { items: Item[]; active: Item | null }) {
	return (
		<ol class="log">
			{props.items.map((item) => (
				<Row item={item} current={item === props.active} />
			))}
		</ol>
	);
}

function Project(props: { view: ProjectView }) {
	const { project, state, error } = props.view;
	const base = projectURL(project.owner, project.name);
	return (
		<li class="entry">
			<span class="ql-marker" />
			<a class="entry-title" href={base}>
				{project.owner}/{project.name}
			</a>
			<span class="entry-meta">
				{error ? (
					<span role="alert">Unavailable: {error}</span>
				) : (
					<>
						<span>{project.state === "enabled" ? "Contributions enabled" : "Contributions paused"}</span>
						{!state?.project.available && <span>Refresh needed</span>}
						{state?.failure && <span role="alert">Background read failed: {state.failure}</span>}
						<a href={`${base}/board`}>Quest board</a>
						<a href={`${base}/state`}>Activity</a>
					</>
				)}
			</span>
			{!error && (
				<span class="entry-meta project-actions">
					<Refresh project={project} />
					{project.state === "enabled" && state?.project.available && (
						<form method="post" action={`${base}/jobs`}>
							<input type="hidden" name="workflow" value="plan" />
							<input type="hidden" name="revision" value={state.project.commit} />
							<button class="button quiet">Start a planning interview</button>
						</form>
					)}
				</span>
			)}
		</li>
	);
}

export function InboxPage(props: InboxProps) {
	const { active } = props;
	const view = active && props.projects.find((v) => v.project.id === active.project.id);
	const unread = props.decisions.filter((item) => item.unread).length;
	const next = props.decisions.filter((item) => item !== active);
	return (
		<section class="wrap inbox">
			<h1>Decisions</h1>
			<p class="muted">
				{props.decisions.length
					? `${props.decisions.length} waiting on you${unread ? `, ${unread} new` : ""}.`
					: "Nothing needs a decision right now."}
			</p>
			{props.done && Object.hasOwn(recorded, props.done) && (
				<p class="note" role="status">
					{recorded[props.done as Done]}
				</p>
			)}
			<Notifications publicKey={props.notifications} compact />
			{props.missing && (
				<p class="note" role="status">
					That decision is no longer open. It may have been answered or changed on GitHub.
				</p>
			)}
			{active && (
				<Thread
					item={active}
					view={view ?? undefined}
					runners={props.runners.get(active.job?.actor ?? "") ?? []}
					user={props.user}
				/>
			)}
			{next.length > 0 && (
				<section>
					<h2>Up next</h2>
					<List items={next} active={active} />
				</section>
			)}
			{props.working.length > 0 && (
				<section>
					<h2>In progress</h2>
					<List items={props.working} active={active} />
				</section>
			)}
			<section>
				<h2>Projects</h2>
				{props.projects.length ? (
					<ul class="log">
						{props.projects.map((view) => (
							<Project view={view} />
						))}
					</ul>
				) : (
					<p>
						No enrolled projects yet. <a href="/projects">Enroll a project</a>, or open one a co-maintainer
						enrolled, to get its issues, pull requests, and ready quests here.
					</p>
				)}
				<p class="note-small muted">
					Lists enrolled projects you maintain, once you open each one's setup page. Runners and accounts are
					set up with <code>quest runner</code>; <a href="/runners">your runners</a> shows them and the order
					jobs use your accounts in.
				</p>
			</section>
			{props.skipped.length > 0 && (
				<details class="skipped">
					<summary>Skipped and finished ({props.skipped.length})</summary>
					<List items={props.skipped} active={active} />
				</details>
			)}
		</section>
	);
}
