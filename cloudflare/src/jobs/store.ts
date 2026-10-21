// Durable job coordination: one authorized attempt owns a job at a time.
//
// D1 is the record. Each owner's RunnerHub Durable Object holds their
// runners' live connections and drives these functions; every runner write
// names its (job, attempt) and only lands while that attempt is current. An
// assignment increments the attempt, so a runner that went offline and
// returns after its job was reassigned is fenced out.

/** A disconnected runner's running jobs move to another runner after this long. */
export const GRACE = 2 * 60_000;

export type Workflow = "plan" | "start" | "iterate" | "bootstrap";
export type JobState = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type Outcome = "completed" | "failed" | "cancelled" | "limited";
export type Platform = "linux" | "darwin";

export class JobError extends Error {}

export type Runner = { id: string; owner: string; name: string; platform: Platform; vm: number };
export type AccountReport = {
	id: string;
	provider: string;
	kind: "subscription" | "api-key";
	label: string;
	limited: boolean;
};
export type Attempt = { job: string; attempt: number };
export type Job = {
	id: string;
	repository: number;
	workflow: Workflow;
	target: string;
	revision: string;
	branch: string;
	actor: string;
	trusted: number;
	pinRunner: string | null;
	pinAccount: string | null;
	state: JobState;
	attempt: number;
	runner: string | null;
	account: string | null;
	session: string | null;
	/** While its runner is disconnected, when the running attempt moves. */
	lease: number | null;
	cancel: number;
	summary: string | null;
	result: string | null;
	/** The commit the job's branch holds; null until its first publication. */
	head: string | null;
	/** A commit whose branch update may be in flight, and since when. */
	pending: string | null;
	pendingAt: number | null;
	/** The pull request this job delivered. */
	pull: number | null;
	createdAt: number;
	updatedAt: number;
};
export type QuestionKind = "agent" | "account" | "publication";
export type Question = {
	id: string;
	attempt: number;
	kind: QuestionKind;
	prompt: unknown;
	answer: unknown;
	answeredBy: string | null;
	askedAt: number;
	answeredAt: number | null;
};
export type Event = { attempt: number; kind: string; body: unknown; at: number };
/** A connected runner's account, as routing sees it. */
export type Offer = {
	runner: string;
	account: string;
	platform: Platform;
	vm: number;
	/** Whether the runner has a free job slot. */
	free: boolean;
	limited: boolean;
};

async function digest(token: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Register a machine for `owner`. The token is shown once; only its hash is kept. */
export async function createRunner(
	db: D1Database,
	owner: string,
	name: string,
	platform: Platform,
	vm: boolean,
	now: number,
) {
	const id = crypto.randomUUID();
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
	await db
		.prepare("INSERT INTO runners(id,owner,name,tokenHash,platform,vm,createdAt) VALUES(?,?,?,?,?,?,?)")
		.bind(id, owner, name, await digest(token), platform, vm ? 1 : 0, now)
		.run();
	return { id, token };
}

export async function authenticate(db: D1Database, token: string): Promise<Runner | null> {
	return db
		.prepare("SELECT id,owner,name,platform,vm FROM runners WHERE tokenHash=?")
		.bind(await digest(token))
		.first<Runner>();
}

/** The owner's runners and accounts; `online` is the hub's live connections. */
export async function listRunners(db: D1Database, owner: string, online: Set<string>) {
	const [runners, accounts] = await db.batch([
		db.prepare("SELECT id,name,platform,vm,seenAt FROM runners WHERE owner=? ORDER BY createdAt,id").bind(owner),
		db
			.prepare(
				"SELECT a.runner,a.id,a.provider,a.kind,a.label,a.rank,a.limited FROM runner_accounts a JOIN runners r ON r.id=a.runner WHERE r.owner=? ORDER BY a.rank,a.runner,a.id",
			)
			.bind(owner),
	]);
	type Row = { id: string; name: string; platform: Platform; vm: number; seenAt: number | null };
	type Account = {
		runner: string;
		id: string;
		provider: string;
		kind: string;
		label: string;
		rank: number;
		limited: number;
	};
	return (runners!.results as Row[]).map((runner) => ({
		...runner,
		online: online.has(runner.id),
		accounts: (accounts!.results as Account[]).filter((account) => account.runner === runner.id),
	}));
}

const fence = "EXISTS(SELECT 1 FROM jobs WHERE id=? AND attempt=? AND runner=? AND state='running')";

/**
 * A connected runner's status: its current accounts and the attempts it is
 * running. Listing an attempt acknowledges its assignment. Says which
 * reported attempts to continue, cancel, or stop because they are no longer
 * this runner's. An acknowledged attempt the status omits was lost, so it
 * moves now; an unacknowledged one may still be on its way.
 */
export async function report(
	db: D1Database,
	runner: Runner,
	accounts: AccountReport[],
	attempts: Attempt[],
	now: number,
) {
	const reported = JSON.stringify(accounts);
	const running = JSON.stringify(attempts);
	const listed =
		"(id,attempt) IN (SELECT json_extract(value,'$.job'),json_extract(value,'$.attempt') FROM json_each(?))";
	const results = await db.batch([
		db.prepare("UPDATE runners SET seenAt=? WHERE id=?").bind(now, runner.id),
		db
			.prepare(
				"DELETE FROM runner_accounts WHERE runner=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
			)
			.bind(runner.id, reported),
		// New accounts join the end of the owner's preference order, in reported order.
		db
			.prepare(
				`INSERT INTO runner_accounts(runner,id,provider,kind,label,limited,rank)
 SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.provider'),json_extract(value,'$.kind'),json_extract(value,'$.label'),json_extract(value,'$.limited'),
  (SELECT COALESCE(MAX(a.rank),0) FROM runner_accounts a JOIN runners r ON r.id=a.runner WHERE r.owner=?)+key+1
 FROM json_each(?) WHERE true
 ON CONFLICT(runner,id) DO UPDATE SET provider=excluded.provider,kind=excluded.kind,label=excluded.label,limited=excluded.limited`,
			)
			.bind(runner.id, runner.owner, reported),
		db
			.prepare(
				`UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'queued' END,lease=NULL,updatedAt=? WHERE runner=? AND state='running' AND delivered=1 AND NOT ${listed}`,
			)
			.bind(now, runner.id, running),
		db
			.prepare(`UPDATE jobs SET delivered=1 WHERE runner=? AND state='running' AND delivered=0 AND ${listed}`)
			.bind(runner.id, running),
		db
			.prepare(
				"SELECT id,attempt,runner,state,cancel FROM jobs WHERE id IN (SELECT json_extract(value,'$.job') FROM json_each(?))",
			)
			.bind(running),
	]);
	const rows = results.at(-1)!.results as Pick<Job, "id" | "attempt" | "runner" | "state" | "cancel">[];
	return attempts.map(({ job, attempt }) => {
		const row = rows.find((r) => r.id === job);
		const owned = row && row.attempt === attempt && row.runner === runner.id && row.state === "running";
		return { job, attempt, action: !owned ? "stop" : row.cancel ? "cancel" : "continue" } as const;
	});
}

/**
 * Pick where a job runs: its pins, trust, and paused session narrow the
 * offers, which arrive in the owner's account preference order. Returns null
 * while the right runner is busy or offline.
 */
export function route(job: Job, offers: Offer[]): Offer | null {
	const eligible = offers.filter(
		(offer) =>
			(!job.pinRunner || offer.runner === job.pinRunner) &&
			(!job.pinAccount || offer.account === job.pinAccount) &&
			(job.trusted || (offer.platform === "linux" && offer.vm)),
	);
	// Resume a paused session where it lives while that runner is online;
	// another runner would start an unrelated agent instead.
	if (job.session) {
		const home = eligible.find((offer) => offer.runner === job.runner && offer.account === job.account);
		if (home) return home.free && !home.limited ? home : null;
	}
	return eligible.find((offer) => offer.free && !offer.limited) ?? null;
}

export type Claimed = NonNullable<Awaited<ReturnType<typeof readJob>>> & { owner: string; name: string };

/**
 * Reconcile an owner's jobs with their connected runners and free slots.
 * A running job has a lease exactly while its runner is disconnected; an
 * expired lease moves the job. Then queued work is assigned. Returns what to
 * send each runner and when to run again. Every assignment its runner has
 * not acknowledged is sent again, since a delivery can be lost after the
 * claim commits. Until acknowledged, an assignment holds one of the runner's
 * reported free slots, which it could not count yet.
 */
export async function dispatch(db: D1Database, owner: string, slots: Map<string, number>, now: number) {
	const connected = JSON.stringify([...slots.keys()]);
	const [, , , , candidates, offers, cancels, pending] = await db.batch([
		db
			.prepare(
				"UPDATE jobs SET lease=NULL WHERE actor=? AND state='running' AND lease IS NOT NULL AND runner IN (SELECT value FROM json_each(?))",
			)
			.bind(owner, connected),
		db
			.prepare(
				"UPDATE jobs SET lease=? WHERE actor=? AND state='running' AND lease IS NULL AND runner NOT IN (SELECT value FROM json_each(?))",
			)
			.bind(now + GRACE, owner, connected),
		// An abandoned attempt that was asked to cancel stops rather than moving.
		db
			.prepare(
				"UPDATE jobs SET state='cancelled',lease=NULL,updatedAt=? WHERE actor=? AND state='running' AND cancel=1 AND lease<=?",
			)
			.bind(now, owner, now),
		db
			.prepare(
				"UPDATE jobs SET state='queued',lease=NULL,updatedAt=? WHERE actor=? AND state='running' AND lease<=?",
			)
			.bind(now, owner, now),
		// A paused project starts and continues nothing new.
		db
			.prepare(
				`SELECT j.* FROM jobs j JOIN github_projects p ON p.id=j.repository
 WHERE j.actor=? AND p.state='enabled' AND j.cancel=0 AND j.state='queued' ORDER BY j.createdAt,j.id`,
			)
			.bind(owner),
		db
			.prepare(
				`SELECT a.runner,a.id AS account,r.platform,r.vm,a.limited FROM runner_accounts a JOIN runners r ON r.id=a.runner
 WHERE r.owner=? AND r.id IN (SELECT value FROM json_each(?)) ORDER BY a.rank,a.runner,a.id`,
			)
			.bind(owner, connected),
		db
			.prepare(
				"SELECT id AS job,attempt,runner FROM jobs WHERE actor=? AND state='running' AND cancel=1 AND runner IN (SELECT value FROM json_each(?))",
			)
			.bind(owner, connected),
		db
			.prepare(
				"SELECT runner,COUNT(*) AS n FROM jobs WHERE actor=? AND state='running' AND delivered=0 GROUP BY runner",
			)
			.bind(owner),
	]);
	const free = new Map(slots);
	for (const { runner, n } of pending!.results as { runner: string; n: number }[])
		if (free.has(runner)) free.set(runner, free.get(runner)! - n);
	type Row = Omit<Offer, "free" | "limited"> & { limited: number };
	const accounts = offers!.results as Row[];
	// Every queued job is considered, so unroutable older ones cannot starve newer ones.
	for (const job of candidates!.results as Job[]) {
		if (![...free.values()].some((n) => n > 0)) break;
		const chosen = route(
			job,
			accounts.map((o) => ({ ...o, free: (free.get(o.runner) ?? 0) > 0, limited: !!o.limited })),
		);
		if (!chosen) continue;
		const [update] = await db.batch([
			db
				.prepare(
					`UPDATE jobs SET state='running',attempt=attempt+1,runner=?,account=?,session=CASE WHEN runner=? AND account=? THEN session END,lease=NULL,delivered=0,updatedAt=?
 WHERE id=? AND attempt=? AND cancel=0 AND state='queued' AND EXISTS(SELECT 1 FROM github_projects WHERE id=jobs.repository AND state='enabled')`,
				)
				.bind(chosen.runner, chosen.account, chosen.runner, chosen.account, now, job.id, job.attempt),
			// changes() is the update above, so only the pass that moved the job records it.
			db
				.prepare(
					"INSERT INTO job_events(job,attempt,kind,body,at) SELECT id,attempt,'claimed',json_object('runner',runner,'account',account),? FROM jobs WHERE changes()=1 AND id=? AND attempt=? AND runner=?",
				)
				.bind(now, job.id, job.attempt + 1, chosen.runner),
		]);
		// The job or its project changed underneath this pass; the next one sees it.
		if (update!.meta.changes !== 1) continue;
		free.set(chosen.runner, free.get(chosen.runner)! - 1);
	}
	const undelivered = await db
		.prepare(
			`SELECT j.id,j.runner,p.owner,p.name FROM jobs j JOIN github_projects p ON p.id=j.repository
 WHERE j.actor=? AND j.state='running' AND j.delivered=0 AND j.cancel=0 AND j.runner IN (SELECT value FROM json_each(?)) ORDER BY j.createdAt,j.id`,
		)
		.bind(owner, connected)
		.all<{ id: string; runner: string; owner: string; name: string }>();
	const assign: { runner: string; job: Claimed }[] = [];
	for (const { id, runner, ...project } of undelivered.results) {
		const job = await readJob(db, id);
		if (job) assign.push({ runner, job: { ...job, ...project } });
	}
	const wake = await db
		.prepare("SELECT MIN(lease) AS at FROM jobs WHERE actor=? AND state='running' AND lease IS NOT NULL")
		.bind(owner)
		.first<{ at: number | null }>();
	return {
		assign,
		cancel: cancels!.results as (Attempt & { runner: string })[],
		wake: wake?.at ?? null,
	};
}

/** Record a checkpoint summary from the current attempt. */
export async function checkpoint(
	db: D1Database,
	runner: Runner,
	job: string,
	attempt: number,
	summary: string,
	session: string | null,
	now: number,
) {
	const [, update] = await db.batch([
		// A retried checkpoint repeats the job's latest event, which it does not record again.
		db
			.prepare(
				`INSERT INTO job_events(job,attempt,kind,body,at) SELECT ?,?,'summary',json_quote(?),? WHERE ${fence}
 AND NOT EXISTS(SELECT 1 FROM job_events WHERE rowid=(SELECT MAX(rowid) FROM job_events WHERE job=?) AND attempt=? AND kind='summary' AND body=json_quote(?))`,
			)
			.bind(job, attempt, summary, now, job, attempt, runner.id, job, attempt, summary),
		db
			.prepare(
				"UPDATE jobs SET summary=?,session=COALESCE(?,session),updatedAt=? WHERE id=? AND attempt=? AND runner=? AND state='running' RETURNING cancel",
			)
			.bind(summary, session, now, job, attempt, runner.id),
	]);
	const row = update!.results[0] as { cancel: number } | undefined;
	if (!row) throw new JobError("Attempt is no longer current");
	return { cancel: !!row.cancel };
}

/**
 * Pause the current attempt on a question, keeping its session to resume.
 * A job already asked to cancel stops instead.
 */
export async function ask(
	db: D1Database,
	runner: Runner,
	job: string,
	attempt: number,
	input: { kind?: QuestionKind; summary: string; session: string | null; prompt: unknown },
	now: number,
) {
	const id = crypto.randomUUID();
	const [question, , update] = await db.batch([
		db
			.prepare(
				`INSERT INTO job_questions(id,job,attempt,kind,prompt,askedAt) SELECT ?,?,?,?,?,? WHERE ${fence} ON CONFLICT(job,attempt) DO NOTHING`,
			)
			.bind(id, job, attempt, input.kind ?? "agent", JSON.stringify(input.prompt), now, job, attempt, runner.id),
		db
			.prepare(
				`INSERT INTO job_events(job,attempt,kind,body,at) SELECT ?,?,'summary',json_quote(?),? WHERE ${fence}`,
			)
			.bind(job, attempt, input.summary, now, job, attempt, runner.id),
		db
			.prepare(
				"UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'waiting' END,summary=?,session=COALESCE(?,session),lease=NULL,updatedAt=? WHERE id=? AND attempt=? AND runner=? AND state='running' AND EXISTS(SELECT 1 FROM job_questions WHERE id=?) RETURNING cancel",
			)
			.bind(input.summary, input.session, now, job, attempt, runner.id, id),
	]);
	if (question!.meta.changes === 1)
		return { question: id, cancel: !!(update!.results[0] as { cancel: number }).cancel };
	// An identical retry after the first request landed; anything else is refused.
	const existing = await db
		.prepare(
			"SELECT q.id,j.cancel FROM job_questions q JOIN jobs j ON j.id=q.job WHERE q.job=? AND q.attempt=? AND q.kind=? AND q.prompt=? AND j.summary=? AND j.session IS COALESCE(?,j.session) AND j.attempt=? AND j.runner=?",
		)
		.bind(
			job,
			attempt,
			input.kind ?? "agent",
			JSON.stringify(input.prompt),
			input.summary,
			input.session,
			attempt,
			runner.id,
		)
		.first<{ id: string; cancel: number }>();
	if (!existing) throw new JobError("Attempt is no longer current");
	return { question: existing.id, cancel: !!existing.cancel };
}

/**
 * Finish the current attempt. An account limit pauses the job with a
 * decision instead of moving it to another account. A requested cancel wins
 * over whatever the runner reports, keeping its partial result.
 */
export async function finish(
	db: D1Database,
	runner: Runner,
	job: string,
	attempt: number,
	input: { outcome: Outcome; summary: string; result: unknown },
	now: number,
) {
	const body = JSON.stringify({ outcome: input.outcome, summary: input.summary });
	const stored = input.result === undefined ? null : JSON.stringify(input.result);
	const statements = [
		db
			.prepare(`INSERT INTO job_events(job,attempt,kind,body,at) SELECT ?,?,'result',?,? WHERE ${fence}`)
			.bind(job, attempt, body, now, job, attempt, runner.id),
	];
	if (input.outcome === "limited") {
		statements.push(
			db
				.prepare(
					`UPDATE runner_accounts SET limited=1 WHERE runner=? AND id=(SELECT account FROM jobs WHERE id=?) AND ${fence}`,
				)
				.bind(runner.id, job, job, attempt, runner.id),
			db
				.prepare(
					`INSERT INTO job_questions(id,job,attempt,kind,prompt,askedAt) SELECT ?,id,attempt,'account',json_object('runner',runner,'account',account),? FROM jobs WHERE id=? AND attempt=? AND runner=? AND state='running' AND cancel=0 ON CONFLICT(job,attempt) DO NOTHING`,
				)
				.bind(crypto.randomUUID(), now, job, attempt, runner.id),
		);
	}
	statements.push(
		db
			.prepare(
				"UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE ? END,summary=?,result=?,lease=NULL,updatedAt=? WHERE id=? AND attempt=? AND runner=? AND state='running'",
			)
			.bind(
				input.outcome === "limited" ? "waiting" : input.outcome,
				input.summary,
				stored,
				now,
				job,
				attempt,
				runner.id,
			),
	);
	const results = await db.batch(statements);
	if (results.at(-1)!.meta.changes === 1) return;
	// An identical retry after the first report landed is accepted; anything else is refused.
	const landed = await db
		.prepare(
			"SELECT 1 FROM job_events e JOIN jobs j ON j.id=e.job WHERE e.job=? AND e.attempt=? AND e.kind='result' AND e.body=? AND j.result IS ? AND j.attempt=? AND j.runner=?",
		)
		.bind(job, attempt, body, stored, attempt, runner.id)
		.first();
	if (!landed) throw new JobError("Attempt is no longer current");
}

/** How long an unrecorded branch update blocks another publication of the same job. */
export const PENDING = 2 * 60_000;

export type Publishing = Job & { owner: string; name: string; project: "enabled" | "paused" };

/** The job a publication is for, only while the publishing attempt is current. */
export async function publishing(db: D1Database, runner: Runner, job: string, attempt: number) {
	const row = await db
		.prepare(
			"SELECT j.*,p.owner,p.name,p.state AS project FROM jobs j JOIN github_projects p ON p.id=j.repository WHERE j.id=? AND j.attempt=? AND j.runner=? AND j.state='running'",
		)
		.bind(job, attempt, runner.id)
		.first<Publishing>();
	if (!row) throw new JobError("Attempt is no longer current");
	return row;
}

/** Record a pending commit that the branch shows landed after all. */
export async function adopt(db: D1Database, job: string, head: string | null, pending: string, now: number) {
	await db
		.prepare(
			"UPDATE jobs SET head=pending,pending=NULL,pendingAt=NULL,updatedAt=? WHERE id=? AND head IS ? AND pending=?",
		)
		.bind(now, job, head, pending)
		.run();
}

/**
 * Reserve the branch update to `commit`, immediately before making it: only
 * while the attempt is current, the branch is where the job last saw it, and
 * no other update of it may still be in flight.
 */
export async function claim(
	db: D1Database,
	runner: Runner,
	job: string,
	attempt: number,
	head: string | null,
	commit: string,
	now: number,
) {
	const result = await db
		.prepare(
			"UPDATE jobs SET pending=?,pendingAt=?,updatedAt=? WHERE id=? AND attempt=? AND runner=? AND state='running' AND head IS ? AND (pending IS NULL OR pendingAt<=?)",
		)
		.bind(commit, now, now, job, attempt, runner.id, head, now - PENDING)
		.run();
	if (result.meta.changes !== 1)
		throw new JobError("Attempt is no longer current, or another publication of this job is in flight");
}

/** Record whether the reserved branch update landed. The branch's head follows it either way. */
export async function settle(db: D1Database, job: string, commit: string, landed: boolean, now: number) {
	await db
		.prepare(
			landed
				? "UPDATE jobs SET head=pending,pending=NULL,pendingAt=NULL,updatedAt=? WHERE id=? AND pending=?"
				: "UPDATE jobs SET pending=NULL,pendingAt=NULL,updatedAt=? WHERE id=? AND pending=?",
		)
		.bind(now, job, commit)
		.run();
}

/** The job's answered agent questions, oldest first, for its pull request's decision record. */
export async function decisions(db: D1Database, job: string) {
	const { results } = await db
		.prepare(
			"SELECT prompt,answer FROM job_questions WHERE job=? AND kind='agent' AND answer IS NOT NULL ORDER BY askedAt,rowid",
		)
		.bind(job)
		.all<{ prompt: string; answer: string }>();
	return results.map((row) => ({
		prompt: JSON.parse(row.prompt) as unknown,
		answer: JSON.parse(row.answer) as unknown,
	}));
}

/** Remember the pull request a job delivered, so later deliveries update it. */
export async function delivered(db: D1Database, job: string, pull: number) {
	await db.prepare("UPDATE jobs SET pull=? WHERE id=?").bind(pull, job).run();
}

export type NewJob = Pick<Job, "repository" | "workflow" | "target" | "revision" | "branch" | "actor"> & {
	trusted: boolean;
	pinRunner?: string | null;
	pinAccount?: string | null;
};

/** Create a job, or return the active job already doing the same work. */
export async function createJob(db: D1Database, input: NewJob, now: number) {
	if (input.pinAccount && !input.pinRunner) throw new JobError("Pin an account together with its runner");
	// Routing needs both pins to match one reported account, or the job never runs.
	const pinnable =
		"(? IS NULL OR EXISTS(SELECT 1 FROM runners r WHERE r.id=? AND r.owner=? AND (?=1 OR (r.platform='linux' AND r.vm=1)) AND (? IS NULL OR EXISTS(SELECT 1 FROM runner_accounts a WHERE a.runner=r.id AND a.id=?))))";
	const runner = input.pinRunner ?? null;
	const account = input.pinAccount ?? null;
	const trusted = input.trusted ? 1 : 0;
	const pin = [runner, runner, input.actor, trusted, account, account];
	const id = crypto.randomUUID();
	// The insert checks the project and pins again, since a pause or a
	// runner's status can commit after the request read them. An iteration
	// continues the pull request's existing head branch. Retrying a target
	// whose latest job failed continues that job's branch and pull request
	// where it left them, as a reassigned attempt would.
	const [insert, active, enabled, pinned] = await db.batch([
		db
			.prepare(
				`INSERT OR IGNORE INTO jobs(id,repository,workflow,target,revision,branch,head,pending,pendingAt,pull,actor,trusted,pinRunner,pinAccount,state,createdAt,updatedAt)
 SELECT ?,p.id,?,?,?,?,COALESCE(?,f.head),f.pending,f.pendingAt,f.pull,?,?,?,?,'queued',?,? FROM github_projects p
 LEFT JOIN jobs f ON ?<>'iterate' AND f.state='failed' AND f.branch=? AND f.id=(SELECT id FROM jobs WHERE repository=p.id AND target=? ORDER BY createdAt DESC,id LIMIT 1)
 WHERE p.id=? AND p.state='enabled' AND ${pinnable}`,
			)
			.bind(
				id,
				input.workflow,
				input.target,
				input.revision,
				input.branch,
				input.workflow === "iterate" ? input.revision : null,
				input.actor,
				trusted,
				runner,
				account,
				now,
				now,
				input.workflow,
				input.branch,
				input.target,
				input.repository,
				...pin,
			),
		db
			.prepare("SELECT id FROM jobs WHERE repository=? AND target=? AND state IN ('queued','running','waiting')")
			.bind(input.repository, input.target),
		db.prepare("SELECT 1 FROM github_projects WHERE id=? AND state='enabled'").bind(input.repository),
		db.prepare(`SELECT ${pinnable} AS ok`).bind(...pin),
	]);
	if (insert!.meta.changes === 1) return { id, created: true };
	if (!enabled!.results.length) throw new JobError("Contributions are paused");
	if (!(pinned!.results[0] as { ok: number }).ok) throw new JobError("Pinned runner or account unavailable");
	const found = active!.results[0] as { id: string } | undefined;
	if (!found) throw new JobError("Job changed; try again");
	return { id: found.id, created: false };
}

export async function readJob(db: D1Database, id: string) {
	const [job, events, questions] = await db.batch([
		db.prepare("SELECT * FROM jobs WHERE id=?").bind(id),
		db.prepare("SELECT attempt,kind,body,at FROM job_events WHERE job=? ORDER BY rowid").bind(id),
		db
			.prepare(
				"SELECT id,attempt,kind,prompt,answer,answeredBy,askedAt,answeredAt FROM job_questions WHERE job=? ORDER BY askedAt,rowid",
			)
			.bind(id),
	]);
	const row = job!.results[0] as Job | undefined;
	if (!row) return null;
	const json = (value: string | null): unknown => (value === null ? null : JSON.parse(value));
	return {
		...row,
		result: json(row.result),
		events: (events!.results as Event[]).map((e) => ({ ...e, body: json(e.body as string) })),
		questions: (questions!.results as Question[]).map((q) => ({
			...q,
			prompt: json(q.prompt as string),
			answer: json(q.answer as string | null),
		})),
	};
}

export async function listJobs(db: D1Database, repository: number) {
	const rows = await db
		.prepare("SELECT id FROM jobs WHERE repository=? ORDER BY createdAt DESC,id LIMIT 50")
		.bind(repository)
		.all<{ id: string }>();
	return (await Promise.all(rows.results.map((row) => readJob(db, row.id)))).filter((job) => job !== null);
}

/** The pull request of the target's latest job when that job failed: what a retry continues. */
export async function failedPull(db: D1Database, repository: number, target: string) {
	const latest = await db
		.prepare("SELECT state,pull FROM jobs WHERE repository=? AND target=? ORDER BY createdAt DESC,id LIMIT 1")
		.bind(repository, target)
		.first<Pick<Job, "state" | "pull">>();
	return latest?.state === "failed" ? latest.pull : null;
}

/** Whether a job on `target` is queued, running, or waiting, and so may still push to it. */
export async function active(db: D1Database, repository: number, target: string) {
	return !!(await db
		.prepare(
			"SELECT 1 FROM jobs WHERE repository=? AND target=? AND state IN ('queued','running','waiting') LIMIT 1",
		)
		.bind(repository, target)
		.first());
}

/**
 * The inbox's jobs, newest first: each target's latest job, however old, when
 * it awaits a decision (queued, running, waiting, or failed) or its target is
 * one of the `observed` issues, pull requests, or ready quests.
 */
export async function listInboxJobs(db: D1Database, repository: number, observed: string[]) {
	const rows = await db
		.prepare(
			`SELECT id FROM jobs j WHERE repository=?1
				AND NOT EXISTS(SELECT 1 FROM jobs n WHERE n.repository=?1 AND n.target=j.target AND (n.createdAt>j.createdAt OR (n.createdAt=j.createdAt AND n.id<j.id)))
				AND (state IN ('queued','running','waiting','failed') OR target IN (SELECT value FROM json_each(?2)))
			ORDER BY createdAt DESC,id`,
		)
		.bind(repository, JSON.stringify(observed))
		.all<{ id: string }>();
	return (await Promise.all(rows.results.map((row) => readJob(db, row.id)))).filter((job) => job !== null);
}

/**
 * Answer the job's open question once, then requeue it. An account decision
 * pins the chosen account and starts a new session from the job's summaries.
 */
export async function answer(db: D1Database, job: string, question: string, user: string, reply: unknown, now: number) {
	const open = await db
		.prepare(
			"SELECT q.kind,j.actor,j.trusted FROM job_questions q JOIN jobs j ON j.id=q.job WHERE q.id=? AND q.job=? AND q.answer IS NULL AND q.attempt=j.attempt AND j.state='waiting'",
		)
		.bind(question, job)
		.first<{ kind: QuestionKind; actor: string; trusted: number }>();
	if (!open) throw new JobError("Question is no longer open");
	let pin: { runner: string; account: string } | null = null;
	if (open.kind === "account") {
		const choice = reply as { runner?: unknown; account?: unknown } | null;
		const owned =
			typeof choice?.runner === "string" &&
			typeof choice.account === "string" &&
			(await db
				.prepare(
					"SELECT 1 FROM runner_accounts a JOIN runners r ON r.id=a.runner WHERE a.runner=? AND a.id=? AND r.owner=? AND (?=1 OR (r.platform='linux' AND r.vm=1))",
				)
				.bind(choice.runner, choice.account, open.actor, open.trusted)
				.first());
		if (!owned) throw new JobError("Choose one of the job owner's accounts that can run it");
		pin = { runner: choice!.runner as string, account: choice!.account as string };
	}
	const answered = "EXISTS(SELECT 1 FROM job_questions WHERE id=? AND answeredBy=? AND answeredAt=?)";
	const statements = [
		// The runner may drop the chosen account after the check above.
		db
			.prepare(
				"UPDATE job_questions SET answer=?,answeredBy=?,answeredAt=? WHERE id=? AND job=? AND answer IS NULL AND attempt=(SELECT attempt FROM jobs WHERE id=? AND state='waiting') AND (? IS NULL OR EXISTS(SELECT 1 FROM runner_accounts WHERE runner=? AND id=?))",
			)
			.bind(
				JSON.stringify(reply),
				user,
				now,
				question,
				job,
				job,
				pin?.runner ?? null,
				pin?.runner ?? null,
				pin?.account ?? null,
			),
	];
	if (pin)
		statements.push(
			// Choosing the limited account again is the maintainer's explicit retry.
			db
				.prepare(
					`UPDATE runner_accounts SET limited=0 WHERE runner=? AND id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='waiting') AND ${answered}`,
				)
				.bind(pin.runner, pin.account, job, question, user, now),
			db
				.prepare(
					`UPDATE jobs SET state='queued',pinRunner=?,pinAccount=?,session=NULL,updatedAt=? WHERE id=? AND state='waiting' AND ${answered}`,
				)
				.bind(pin.runner, pin.account, now, job, question, user, now),
		);
	else
		statements.push(
			db
				.prepare(`UPDATE jobs SET state='queued',updatedAt=? WHERE id=? AND state='waiting' AND ${answered}`)
				.bind(now, job, question, user, now),
		);
	const results = await db.batch(statements);
	if (results[0]!.meta.changes !== 1)
		throw new JobError(pin ? "Question is no longer open or the account is gone" : "Question is no longer open");
}

/**
 * Stop a job. Queued, waiting, and never-acknowledged jobs stop now; a
 * running attempt is asked to cancel and reports its partial result.
 */
export async function cancel(db: D1Database, job: string, user: string, now: number) {
	const [, stopped, asked] = await db.batch([
		db
			.prepare(
				"INSERT INTO job_events(job,attempt,kind,body,at) SELECT id,attempt,'cancel',json_object('by',?),? FROM jobs WHERE id=? AND state IN ('queued','running','waiting') AND cancel=0",
			)
			.bind(user, now, job),
		db
			.prepare(
				"UPDATE jobs SET state='cancelled',lease=NULL,updatedAt=? WHERE id=? AND (state IN ('queued','waiting') OR (state='running' AND delivered=0))",
			)
			.bind(now, job),
		db.prepare("UPDATE jobs SET cancel=1,updatedAt=? WHERE id=? AND state='running'").bind(now, job),
	]);
	if (stopped!.meta.changes + asked!.meta.changes === 0) throw new JobError("Job already finished");
}
