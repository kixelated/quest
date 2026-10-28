import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "../src/inbox/model";
import * as store from "../src/jobs/store";
import { commit, maintainerOf, project } from "./project-fixtures";

const db = env.DB;
let user = "";
beforeEach(async () => {
	({ user } = await maintainerOf());
});
afterEach(() => vi.restoreAllMocks());

/** Count executed statements, including each statement inside a D1 batch. */
function counted() {
	let queries = 0;
	const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
	const statement = (inner: D1PreparedStatement): D1PreparedStatement => {
		const proxy = new Proxy(inner, {
			get(target, key) {
				if (key === "bind") return (...args: unknown[]) => statement(target.bind(...args));
				const value = Reflect.get(target, key, target);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					if (["all", "first", "run", "raw"].includes(String(key))) queries++;
					return value.apply(target, args);
				};
			},
		});
		originals.set(proxy, inner);
		return proxy;
	};
	return {
		db: new Proxy(db, {
			get(target, key) {
				if (key === "prepare") return (sql: string) => statement(target.prepare(sql));
				if (key === "batch")
					return (statements: D1PreparedStatement[]) => {
						queries += statements.length;
						return target.batch(statements.map((s) => originals.get(s) ?? s));
					};
				const value = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}),
		queries: () => queries,
	};
}

/** Many targets, with interleaved attempts, events, answered and unanswered questions. */
async function seed(count: number, repository = 10) {
	const ids: string[] = [];
	const statements: D1PreparedStatement[] = [];
	for (let i = 0; i < count; i++) {
		const id = `job-${repository}-${String(i).padStart(3, "0")}`;
		ids.push(id);
		statements.push(
			db
				.prepare(
					`INSERT INTO jobs(id,repository,workflow,target,revision,branch,actor,trusted,state,attempt,result,createdAt,updatedAt)
					VALUES(?,?,'start',?,?,'quest/work',?,1,?,2,?,?,?)`,
				)
				.bind(
					id,
					repository,
					`quest/job-${i}.md`,
					commit,
					user,
					i % 2 ? "completed" : "waiting",
					JSON.stringify({ followups: [`Follow-up ${i}`] }),
					i,
					100 + i,
				),
		);
		if (i % 3 === 0) continue;
		// Event order follows insertion, not timestamp or attempt.
		for (const attempt of [2, 1])
			statements.push(
				db
					.prepare("INSERT INTO job_events(job,attempt,kind,body,at) VALUES(?,?,'summary',?,?)")
					.bind(id, attempt, JSON.stringify({ summary: `${id}-${attempt}` }), attempt),
			);
		// Questions order by askedAt, using rowid to break ties, not by attempt.
		for (const attempt of [2, 1])
			statements.push(
				db
					.prepare(
						`INSERT INTO job_questions(id,job,attempt,kind,prompt,answer,answeredBy,askedAt,answeredAt,approvedAt)
						VALUES(?,?,?,'agent',?,?,?,?,?,?)`,
					)
					.bind(
						`${id}-${attempt}`,
						id,
						attempt,
						JSON.stringify({ questions: [{ question: `Choice ${id}-${attempt}?`, options: [] }] }),
						attempt === 1 ? JSON.stringify({ text: `Answer ${id}` }) : null,
						attempt === 1 ? user : null,
						attempt,
						attempt === 1 ? 10 : null,
						attempt === 1 ? 11 : null,
					),
			);
	}
	await db.batch(statements);
	return ids;
}

describe("batched inbox reads", () => {
	it("hydrates many jobs identically with a constant number of queries", async () => {
		const observed = Array.from({ length: 120 }, (_, i) => `quest/job-${i}.md`);
		const empty = counted();
		expect(await store.listInboxJobs(empty.db, 10, observed)).toEqual([]);
		expect(empty.queries()).toBe(3);
		const ids = await seed(120);
		await project(11, user);
		await seed(2, 11);
		const expected = await Promise.all([...ids].reverse().map((id) => store.readJob(db, id)));
		const all = counted();
		const result = await store.listInboxJobs(all.db, 10, observed);
		expect(all.queries()).toBe(empty.queries());
		expect(result).toEqual(expected);
		expect(result.find((job) => job.id === ids[1])).toMatchObject({
			attempt: 2,
			result: { followups: ["Follow-up 1"] },
			events: [{ attempt: 2 }, { attempt: 1 }],
			questions: [
				{ attempt: 1, answer: { text: `Answer ${ids[1]}` }, answeredBy: user, answeredAt: 10, approvedAt: 11 },
				{ attempt: 2, answer: null, answeredBy: null, answeredAt: null, approvedAt: null },
			],
		});
		expect(result.find((job) => job.id === ids[0])).toMatchObject({ events: [], questions: [] });
		const active = counted();
		expect(await store.listActivityJobs(active.db, 10, [])).toEqual(
			expected.filter((job) => job!.state === "waiting"),
		);
		expect(active.queries()).toBe(3);
		const recent = counted();
		expect(await store.listJobs(recent.db, 10)).toEqual(expected.slice(0, 50));
		expect(recent.queries()).toBe(3);
	});

	it("keeps the entire inbox load's query count fixed as jobs grow", async () => {
		const read = async () => {
			const queries = counted();
			const result = await load({ ...env, DB: queries.db }, user);
			return { queries: queries.queries(), result };
		};
		const empty = await read();
		await seed(120);
		const many = await read();
		expect(many.queries).toBe(empty.queries);
		expect(many.result.activity[0]).toHaveLength(60);
		expect(many.result.items.filter((item) => item.job)).toHaveLength(60);
	});
});
