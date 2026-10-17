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
	createdAt: number;
	updatedAt: number;
};
export type Question = {
	id: string;
	attempt: number;
	kind: "agent" | "account";
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
 * running. Says which reported attempts to continue, cancel, or stop
 * because they are no longer this runner's. A connection's first status is complete, since nothing has been
 * assigned over it yet, so running attempts it omits were lost and move now.
 */
export async function report(
	db: D1Database,
	runner: Runner,
	accounts: AccountReport[],
	attempts: Attempt[],
	first: boolean,
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
				`UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'queued' END,lease=NULL,updatedAt=? WHERE ?=1 AND runner=? AND state='running' AND NOT ${listed}`,
			)
			.bind(now, first ? 1 : 0, runner.id, running),
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
 * send each runner and when to run again.
 */
export async function dispatch(db: D1Database, owner: string, slots: Map<string, number>, now: number) {
	const connected = JSON.stringify([...slots.keys()]);
	const [, , , , candidates, offers, cancels] = await db.batch([
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
	]);
	const free = new Map(slots);
	type Row = Omit<Offer, "free" | "limited"> & { limited: number };
	const accounts = offers!.results as Row[];
	const assign: { runner: string; job: Claimed }[] = [];
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
					`UPDATE jobs SET state='running',attempt=attempt+1,runner=?,account=?,session=CASE WHEN runner=? AND account=? THEN session END,lease=NULL,updatedAt=?
 WHERE id=? AND attempt=? AND cancel=0 AND state='queued'`,
				)
				.bind(chosen.runner, chosen.account, chosen.runner, chosen.account, now, job.id, job.attempt),
			// changes() is the update above, so only the pass that moved the job records it.
			db
				.prepare(
					"INSERT INTO job_events(job,attempt,kind,body,at) SELECT id,attempt,'claimed',json_object('runner',runner,'account',account),? FROM jobs WHERE changes()=1 AND id=? AND attempt=? AND runner=?",
				)
				.bind(now, job.id, job.attempt + 1, chosen.runner),
		]);
		// The job changed underneath this pass; the next one sees it.
		if (update!.meta.changes !== 1) continue;
		free.set(chosen.runner, free.get(chosen.runner)! - 1);
		const [claimed, project] = await Promise.all([
			readJob(db, job.id),
			db
				.prepare("SELECT owner,name FROM github_projects WHERE id=?")
				.bind(job.repository)
				.first<{ owner: string; name: string }>(),
		]);
		if (claimed && project) assign.push({ runner: chosen.runner, job: { ...claimed, ...project } });
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
		db
			.prepare(
				`INSERT INTO job_events(job,attempt,kind,body,at) SELECT ?,?,'summary',json_quote(?),? WHERE ${fence}`,
			)
			.bind(job, attempt, summary, now, job, attempt, runner.id),
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
	input: { kind?: "agent" | "account"; summary: string; session: string | null; prompt: unknown },
	now: number,
) {
	const id = crypto.randomUUID();
	const [question] = await db.batch([
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
				"UPDATE jobs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'waiting' END,summary=?,session=COALESCE(?,session),lease=NULL,updatedAt=? WHERE id=? AND attempt=? AND runner=? AND state='running' AND EXISTS(SELECT 1 FROM job_questions WHERE id=?)",
			)
			.bind(input.summary, input.session, now, job, attempt, runner.id, id),
	]);
	if (question!.meta.changes === 1) return id;
	// An identical retry after the first request landed; anything else is refused.
	const existing = await db
		.prepare(
			"SELECT q.id FROM job_questions q JOIN jobs j ON j.id=q.job WHERE q.job=? AND q.attempt=? AND q.kind=? AND q.prompt=? AND j.summary=? AND j.session IS COALESCE(?,j.session) AND j.attempt=? AND j.runner=?",
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
		.first<{ id: string }>();
	if (!existing) throw new JobError("Attempt is no longer current");
	return existing.id;
}

/** Append raw agent output from the current attempt, in any state. */
export async function output(db: D1Database, runner: Runner, job: string, attempt: number, text: string, now: number) {
	const result = await db
		.prepare(
			"INSERT INTO job_output(job,attempt,text,at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=? AND attempt=? AND runner=?)",
		)
		.bind(job, attempt, text, now, job, attempt, runner.id)
		.run();
	if (result.meta.changes !== 1) throw new JobError("Attempt is no longer current");
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

export type NewJob = Pick<Job, "repository" | "workflow" | "target" | "revision" | "branch" | "actor"> & {
	trusted: boolean;
	pinRunner?: string | null;
	pinAccount?: string | null;
};

/** Create a job, or return the active job already doing the same work. */
export async function createJob(db: D1Database, input: NewJob, now: number) {
	if (input.pinRunner) {
		// Routing needs both pins to match one reported account, or the job never runs.
		const pinned = await db
			.prepare(
				"SELECT 1 FROM runners r WHERE r.id=? AND r.owner=? AND (?=1 OR (r.platform='linux' AND r.vm=1)) AND (? IS NULL OR EXISTS(SELECT 1 FROM runner_accounts a WHERE a.runner=r.id AND a.id=?))",
			)
			.bind(
				input.pinRunner,
				input.actor,
				input.trusted ? 1 : 0,
				input.pinAccount ?? null,
				input.pinAccount ?? null,
			)
			.first();
		if (!pinned) throw new JobError("Pinned runner or account unavailable");
	} else if (input.pinAccount) throw new JobError("Pin an account together with its runner");
	const id = crypto.randomUUID();
	const result = await db
		.prepare(
			`INSERT OR IGNORE INTO jobs(id,repository,workflow,target,revision,branch,actor,trusted,pinRunner,pinAccount,state,createdAt,updatedAt)
 VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?)`,
		)
		.bind(
			id,
			input.repository,
			input.workflow,
			input.target,
			input.revision,
			input.branch,
			input.actor,
			input.trusted ? 1 : 0,
			input.pinRunner ?? null,
			input.pinAccount ?? null,
			now,
			now,
		)
		.run();
	if (result.meta.changes === 1) return { id, created: true };
	const active = await db
		.prepare("SELECT id FROM jobs WHERE repository=? AND target=? AND state IN ('queued','running','waiting')")
		.bind(input.repository, input.target)
		.first<{ id: string }>();
	if (!active) throw new JobError("Job changed; try again");
	return { id: active.id, created: false };
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
		.first<{ kind: "agent" | "account"; actor: string; trusted: number }>();
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
		db
			.prepare(
				"UPDATE job_questions SET answer=?,answeredBy=?,answeredAt=? WHERE id=? AND job=? AND answer IS NULL AND attempt=(SELECT attempt FROM jobs WHERE id=? AND state='waiting')",
			)
			.bind(JSON.stringify(reply), user, now, question, job, job),
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
	if (results[0]!.meta.changes !== 1) throw new JobError("Question is no longer open");
}

/**
 * Stop a job. Queued and waiting jobs stop now; a running attempt is asked to
 * cancel and reports its partial result.
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
				"UPDATE jobs SET state='cancelled',lease=NULL,updatedAt=? WHERE id=? AND state IN ('queued','waiting')",
			)
			.bind(now, job),
		db.prepare("UPDATE jobs SET cancel=1,updatedAt=? WHERE id=? AND state='running'").bind(now, job),
	]);
	if (stopped!.meta.changes + asked!.meta.changes === 0) throw new JobError("Job already finished");
}

export async function readOutput(db: D1Database, job: string) {
	return (
		await db
			.prepare("SELECT attempt,text,at FROM job_output WHERE job=? ORDER BY rowid")
			.bind(job)
			.all<{ attempt: number; text: string; at: number }>()
	).results;
}
