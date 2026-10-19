// Raw agent output: one R2 object per chunk, indexed in D1.
//
// An attempt's chunks arrive in order, `seq` 0, 1, 2, ... Each is reserved
// first: an index row records its text's hash while the job exists, so a
// conflicting chunk is refused before anything reaches R2. The object is
// written next and the row marked complete, only while the attempt is
// current. A chunk is reserved only once the one before it is complete, so an
// attempt's one pending chunk is its last, and readers that see complete rows
// never page past a chunk that may still land. R2 cannot join a D1 batch, so
// a disconnect or reassignment between those steps leaves no row to complete,
// and the upload deletes its own object.
import { JobError, type Attempt, type Runner } from "./store";

type Storage = Pick<Env, "DB" | "OUTPUT">;

/** Raw output kept per attempt, in UTF-8 bytes. */
export const MAX_BYTES = 64 * 1024 * 1024;
/** Chunks kept per attempt, so tiny chunks cannot multiply rows and objects. */
export const MAX_CHUNKS = 4096;
/** How long output is kept after each chunk's upload; the bucket lifecycle rule matches it. */
export const RETENTION = 30 * 24 * 60 * 60_000;

const key = (job: string, attempt: number, seq: number) => `output/${job}/${attempt}/${seq}`;

async function digest(text: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Store a chunk of the current attempt's output, in any job state. Only the
 * attempt's next `seq` is accepted, or an identical retry of one still
 * indexed. Past the attempt's cap, chunks are refused as `truncated`; the
 * job carries on.
 */
export async function append(
	{ DB: db, OUTPUT: bucket }: Storage,
	runner: Runner,
	{ job, attempt, seq, text }: Attempt & { seq: number; text: string },
	now: number,
): Promise<{ truncated?: true }> {
	const bytes = new TextEncoder().encode(text).length;
	const hash = await digest(text);
	const current = "EXISTS(SELECT 1 FROM jobs WHERE id=?1 AND attempt=?2 AND runner=?3)";
	const next = "job=?1 AND attempt=?2 AND runner=?3 AND next=?4";
	const params = [job, attempt, runner.id, seq, bytes, hash, now];
	const statement = (sql: string, n: number) => db.prepare(sql).bind(...params.slice(0, n));
	const [, , , , read] = await db.batch([
		statement(
			`INSERT INTO job_output_attempts(job,attempt,runner) SELECT ?1,?2,?3 WHERE ${current} ON CONFLICT DO NOTHING`,
			3,
		),
		// The truncation is recorded once, by the first chunk over the cap.
		statement(
			`UPDATE job_output_attempts SET truncated=1 WHERE ${next} AND truncated=0 AND (bytes+?5>${MAX_BYTES} OR next>=${MAX_CHUNKS}) AND ${current}`,
			5,
		),
		statement(
			`INSERT INTO job_output(job,attempt,seq,hash,at) SELECT ?1,?2,?4,?6,?7 FROM job_output_attempts WHERE ${next} AND truncated=0 AND ${current}
 AND NOT EXISTS(SELECT 1 FROM job_output WHERE job=?1 AND attempt=?2 AND seq=?4-1 AND complete=0)`,
			7,
		),
		statement(
			`UPDATE job_output_attempts SET next=next+1,bytes=bytes+?5 WHERE ${next} AND EXISTS(SELECT 1 FROM job_output WHERE job=?1 AND attempt=?2 AND seq=?4)`,
			5,
		),
		statement(
			`SELECT a.runner,a.next,a.truncated,o.hash,o.complete,${current} AS current FROM (SELECT 1)
 LEFT JOIN job_output_attempts a ON a.job=?1 AND a.attempt=?2 LEFT JOIN job_output o ON o.job=?1 AND o.attempt=?2 AND o.seq=?4`,
			4,
		),
	]);
	const row = read!.results[0] as {
		runner: string | null;
		next: number | null;
		truncated: number | null;
		hash: string | null;
		complete: number | null;
		current: number;
	};
	if (row.hash !== null && row.runner === runner.id) {
		if (row.hash !== hash) throw new JobError("A different chunk has that sequence number");
		// A retry of a completed chunk writes nothing, so its lifecycle does not restart.
		if (row.complete) return {};
		const name = key(job, attempt, seq);
		await bucket.put(name, text);
		const done = await db
			.prepare(
				`UPDATE job_output SET complete=1 WHERE job=?1 AND attempt=?2 AND seq=?4 AND hash=?5 AND ${current}`,
			)
			.bind(job, attempt, runner.id, seq, hash)
			.run();
		if (done.meta.changes === 1) return {};
		// The job was disconnected or reassigned while the object was written.
		await bucket.delete(name);
		throw new JobError("Attempt is no longer current");
	}
	if (!row.current || row.runner !== runner.id || row.next === null)
		throw new JobError("Attempt is no longer current");
	if (seq < row.next) throw new JobError("That chunk has expired");
	if (row.truncated) return { truncated: true };
	if (seq === row.next) throw new JobError(`Chunk ${seq - 1} is not stored yet`);
	throw new JobError(`Expected sequence ${row.next}`);
}

/**
 * A page of stored raw output, at most a few MiB, in order; `next` continues
 * it. Only stored chunks are listed: an attempt's one pending chunk is its
 * last and lands only while the attempt is current, so a cursor never passes
 * a chunk that may still land.
 * `truncated` lists the attempts whose output reached the cap.
 */
export async function read(
	{ DB: db, OUTPUT: bucket }: Storage,
	job: string,
	after: { attempt: number; seq: number } | null,
) {
	const page = 4;
	const [rows, capped] = await db.batch([
		db
			.prepare(
				"SELECT attempt,seq,at FROM job_output WHERE job=? AND complete=1 AND (attempt,seq)>(?,?) ORDER BY attempt,seq LIMIT ?",
			)
			.bind(job, after?.attempt ?? 0, after?.seq ?? -1, page),
		db.prepare("SELECT attempt FROM job_output_attempts WHERE job=? AND truncated=1 ORDER BY attempt").bind(job),
	]);
	const index = rows!.results as { attempt: number; seq: number; at: number }[];
	const chunks = await Promise.all(
		index.map(async (chunk) => {
			const object = await bucket.get(key(job, chunk.attempt, chunk.seq));
			// The lifecycle rule may delete an object before the cron deletes its row.
			return object && { ...chunk, text: await object.text() };
		}),
	);
	const last = index.length === page ? index.at(-1)! : null;
	return {
		output: chunks.filter((chunk) => chunk !== null),
		next: last && { attempt: last.attempt, seq: last.seq },
		truncated: (capped!.results as { attempt: number }[]).map((row) => row.attempt),
	};
}

/** Delete the output objects of jobs a disconnect removed. A failure stays queued for the next run. */
export async function purge({ DB: db, OUTPUT: bucket }: Storage) {
	const { results } = await db.prepare("SELECT job FROM output_cleanup ORDER BY at,job").all<{ job: string }>();
	for (const { job } of results) {
		try {
			const prefix = `output/${job}/`;
			for (
				let listed = await bucket.list({ prefix });
				listed.objects.length;
				listed = await bucket.list({ prefix })
			)
				await bucket.delete(listed.objects.map((object) => object.key));
			await db.prepare("DELETE FROM output_cleanup WHERE job=?").bind(job).run();
		} catch (error) {
			console.error({ event: "output_cleanup_failed", name: error instanceof Error ? error.name : "unknown" });
		}
	}
}

/** The daily cron: forget expired chunks, whose objects the lifecycle rule deletes, and retry cleanups. */
export async function retain(storage: Storage, now: number) {
	const batch = 1000;
	for (;;) {
		const deleted = await storage.DB.prepare(
			"DELETE FROM job_output WHERE rowid IN (SELECT rowid FROM job_output WHERE at<=? LIMIT ?)",
		)
			.bind(now - RETENTION, batch)
			.run();
		if (deleted.meta.changes < batch) break;
	}
	await purge(storage);
}
