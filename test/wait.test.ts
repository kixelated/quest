import { expect, test } from "vitest";

import { main } from "../src/cli/main";
import { pullRequest, waitForActivity, WaitTimeout, type WaitDependencies } from "../src/cli/wait";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const POINT = "2026-10-07T12:00:00Z";
const pr = { owner: "example", repo: "project", number: 1 };
const base = "/repos/example/project";
const timeline = `${base}/issues/1/timeline?per_page=100`;

function response(body: unknown, headers?: Record<string, string>, status = 200): Response {
	return new Response(status === 304 ? null : JSON.stringify(body), { status, headers });
}

function pull(headRepo: unknown = { full_name: "contributor/fork" }, sha = A) {
	return response({ base: { sha: C }, head: { sha, ref: "feature/a", repo: headRepo } });
}

function pushed(after = A, time = POINT, type = "push") {
	return { activity_type: type, after, timestamp: time, actor: { login: "author" } };
}

function committed(sha: string) {
	return {
		event: "committed",
		sha,
		committer: { name: "A Person", date: "2000-01-01T00:00:00Z" },
		html_url: `https://github.com/example/project/commit/${sha}`,
	};
}

function reviewed(id = 1, time = POINT) {
	return {
		event: "reviewed",
		id,
		submitted_at: time,
		user: { login: "reviewer" },
		html_url: `https://github.com/example/project/pull/1#pullrequestreview-${id}`,
	};
}

function setup(responses: Response[], baseline = [A]) {
	let now = Date.parse("2026-10-07T12:10:00Z");
	const calls: { path: string; headers: Headers }[] = [];
	const sleeps: number[] = [];
	const warnings: string[] = [];
	const deps: WaitDependencies = {
		token: "test-token",
		now: () => now,
		sleep: async (ms) => {
			sleeps.push(ms);
			now += ms;
		},
		warn: (text) => warnings.push(text),
		fetch: async (url, init) => {
			const parsed = new URL(String(url));
			calls.push({ path: parsed.pathname + parsed.search, headers: new Headers(init?.headers) });
			if (parsed.pathname.endsWith("/commits")) return response(baseline.map((sha) => ({ sha })));
			const next = responses.shift();
			if (!next) throw new Error(`unexpected request: ${parsed.pathname + parsed.search}`);
			return next;
		},
	};
	return { deps, calls, sleeps, warnings, responses };
}

function cursor(lines: string[]): string {
	return lines.at(-1)!.split(" ").at(-1)!;
}

test("default point includes reviews already submitted on the current head and uses the fork's push time", async () => {
	const fixture = setup([pull(), response([pushed()]), response([committed(A), reviewed()])]);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatch(
		/^2026-10-07T12:00:00Z reviewed reviewer https:\/\/github.com\/example\/project\/pull\/1#pullrequestreview-1 q1\./,
	);
	expect(fixture.calls.map((call) => call.path)).toEqual([
		`${base}/pulls/1`,
		`${base}/pulls/1/commits?per_page=100`,
		"/repos/contributor/fork/activity?ref=feature%2Fa&per_page=100",
		timeline,
	]);
	expect(fixture.calls.every((call) => call.headers.get("authorization") === "Bearer test-token")).toBe(true);
	expect(fixture.sleeps).toEqual([]);
});

test("a plain push is detected by new SHA regardless of git dates, with conditional polling", async () => {
	const fixture = setup(
		[
			pull(),
			response([pushed()]),
			response([committed(A)], { etag: '"old"' }),
			response(null, {}, 304),
			response([committed(A), committed(B)]),
		],
		[A],
	);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatch(new RegExp(`^${B} committed A_Person `));
	expect(fixture.sleeps).toEqual([300_000, 300_000]);
	expect(fixture.calls[4].headers.get("if-none-match")).toBe('"old"');
	expect(fixture.calls[5].headers.get("if-none-match")).toBe('"old"');
});

test("force pushes, comments, inline comments, merges and closes are printed without reviewer policy", async () => {
	const event = (event: string, id: number) => ({ event, id, created_at: POINT, actor: { login: "bot[bot]" } });
	const fixture = setup([
		pull(),
		response([pushed()]),
		response([
			event("head_ref_force_pushed", 1),
			event("commented", 2),
			{
				event: "line-commented",
				comments: [
					{
						id: 3,
						created_at: POINT,
						user: { login: "person" },
						html_url: "https://github.com/example/project/pull/1#discussion_r3",
					},
				],
			},
			{ event: "commit-commented", comments: [{ id: 4, created_at: POINT, user: null }] },
			event("merged", 5),
			event("closed", 6),
		]),
	]);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines.map((line) => line.split(" ")[1])).toEqual([
		"head_ref_force_pushed",
		"commented",
		"line-commented",
		"commit-commented",
		"merged",
		"closed",
	]);
});

test("a resume cursor catches same-second activity without replaying events or commits", async () => {
	const first = setup([pull(), response([pushed()]), response([committed(A), reviewed(1)])]);
	const point = cursor(await waitForActivity(pr, {}, first.deps));
	const second = setup([response([committed(A), reviewed(1), reviewed(2), committed(B)])]);
	const lines = await waitForActivity(pr, { since: point }, second.deps);
	expect(lines).toHaveLength(2);
	expect(lines[0].split(" ")).toHaveLength(4);
	expect(lines[1].split(" ")).toHaveLength(5);
	expect(lines.some((line) => line.includes("review-1"))).toBe(false);
	expect(lines.some((line) => line.startsWith(B))).toBe(true);
	const third = setup([response([committed(A), reviewed(1), reviewed(2), committed(B), committed(C)])]);
	const later = await waitForActivity(pr, { since: cursor(lines) }, third.deps);
	expect(later).toHaveLength(1);
	expect(later[0]).toMatch(new RegExp(`^${C} committed `));
});

test("historical timestamp and SHA starts detect pushes through repository activity, not git dates", async () => {
	for (const since of [POINT, A.slice(0, 7)]) {
		const fixture = setup(
			[
				pull(undefined, B),
				response([pushed(B, "2026-10-07T12:05:00Z"), pushed(A, "2026-10-07T11:59:00Z")]),
				response([committed(A), committed(B)]),
			],
			[A, B],
		);
		const lines = await waitForActivity(pr, { since }, fixture.deps);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(
			`2026-10-07T12:05:00Z pushed author https://github.com/contributor/fork/commit/${B}`,
		);
	}
});

test("an explicit timestamp includes a push at that instant", async () => {
	const fixture = setup([pull(undefined, B), response([pushed(B)]), response([committed(A), committed(B)])], [A, B]);
	const lines = await waitForActivity(pr, { since: POINT }, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain(`${POINT} pushed author https://github.com/contributor/fork/commit/${B}`);
});

test("all initial timeline pages are read, and the last known page is polled before following rollover", async () => {
	const page2 = `https://api.github.com${timeline}&page=2`;
	const page3 = `https://api.github.com${timeline}&page=3`;
	const fixture = setup([
		pull(),
		response([pushed()]),
		response([committed(A)], { link: `<${page2}>; rel="next", <${page2}>; rel="last"` }),
		response([], { etag: '"tail"' }),
		response([], { link: `<${page3}>; rel="next"` }),
		response([reviewed()]),
	]);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(fixture.calls.slice(3).map((call) => call.path)).toEqual([
		timeline,
		`${timeline}&page=2`,
		`${timeline}&page=2`,
		`${timeline}&page=3`,
	]);
	expect(fixture.calls.at(-1)!.headers.has("if-none-match")).toBe(false);
});

test("older initial pages are not skipped even when the last page has no recent activity", async () => {
	const page2 = `https://api.github.com${timeline}&page=2`;
	const fixture = setup(
		[
			pull(),
			response([pushed()]),
			response([reviewed(), committed(A)], { link: `<${page2}>; rel="next"` }),
			response([committed(B)]),
		],
		[B, A],
	);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(fixture.calls).toHaveLength(5);
});

test("GitHub errors and malformed successful bodies never become activity", async () => {
	for (const bad of [
		response({ message: "bad credentials" }, {}, 401),
		response({ message: "not an array" }),
		response([{ event: "reviewed", id: 1, submitted_at: "yesterday" }]),
	]) {
		const fixture = setup([pull(), response([pushed()]), bad]);
		await expect(waitForActivity(pr, {}, fixture.deps)).rejects.toThrow();
		expect(fixture.sleeps).toEqual([]);
	}
});

test("rate limits honor Retry-After and then exponentially back off", async () => {
	const fixture = setup([
		response({ message: "rate limit exceeded" }, { "retry-after": "120" }, 429),
		response({ message: "secondary rate limit" }, {}, 403),
		pull(),
		response([pushed()]),
		response([reviewed()]),
	]);
	await waitForActivity(pr, {}, fixture.deps);
	expect(fixture.sleeps).toEqual([120_000, 120_000]);
	expect(fixture.warnings).toHaveLength(2);
});

test("primary rate limit reset and server poll intervals are honored", async () => {
	const reset = Date.parse("2026-10-07T12:11:00Z") / 1000;
	const fixture = setup([
		response(
			{ message: "API rate limit exceeded" },
			{ "x-ratelimit-remaining": "0", "x-ratelimit-reset": `${reset}` },
			403,
		),
		pull(),
		response([pushed()]),
		response([], { "x-poll-interval": "600" }),
		response([reviewed()]),
	]);
	await waitForActivity(pr, {}, fixture.deps);
	expect(fixture.sleeps).toEqual([60_000, 600_000]);
});

test("persistent rate limiting eventually fails loudly instead of masking an error", async () => {
	const fixture = setup(Array.from({ length: 7 }, () => response({ message: "secondary rate limit" }, {}, 403)));
	await expect(waitForActivity(pr, {}, fixture.deps)).rejects.toThrow("rate limit persisted");
	expect(fixture.sleeps).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]);
});

test("a permission-denied 403 fails without rate-limit retries", async () => {
	const fixture = setup([response({ message: "Resource not accessible by integration" }, {}, 403)]);
	await expect(waitForActivity(pr, {}, fixture.deps)).rejects.toThrow("HTTP 403");
	expect(fixture.sleeps).toEqual([]);
});

test("timeout is distinct and limits both poll sleeps and rate-limit waits", async () => {
	for (const responses of [
		[pull(), response([pushed()]), response([])],
		[response({ message: "rate limit" }, { "retry-after": "120" }, 429)],
	]) {
		const fixture = setup(responses);
		await expect(waitForActivity(pr, { timeout: 10 }, fixture.deps)).rejects.toBeInstanceOf(WaitTimeout);
		expect(fixture.sleeps).toEqual([10_000]);
	}
});

test("unresolvable pushed SHA fails with a timestamp recommendation", async () => {
	const fixture = setup([pull(), response([pushed()])]);
	await expect(waitForActivity(pr, { since: B }, fixture.deps)).rejects.toThrow("pass a timestamp with --since");
});

test("SHA lookup paginates repository activity", async () => {
	const fixture = setup(
		[
			pull(undefined, B),
			response([pushed(B, "2026-10-07T12:05:00Z")], {
				link: '<https://api.github.com/repos/contributor/fork/activity?page=2>; rel="next"',
			}),
			response([pushed()]),
			response([committed(A), committed(B)]),
		],
		[A, B],
	);
	const lines = await waitForActivity(pr, { since: A }, fixture.deps);
	expect(lines[0]).toContain("pushed author");
	expect(fixture.calls[3].path).toBe("/repos/contributor/fork/activity?page=2");
});

test("deleted forks accept timestamps but cannot guess SHA push times", async () => {
	const missing = setup([pull(null)]);
	await expect(waitForActivity(pr, {}, missing.deps)).rejects.toThrow("pass a timestamp");
	const timestamp = setup([pull(null), response([reviewed()])]);
	expect(await waitForActivity(pr, { since: POINT }, timestamp.deps)).toHaveLength(1);
});

test("untrusted pagination cannot leak an authorization token", async () => {
	const fixture = setup([
		pull(),
		response([pushed()]),
		response([], { link: '<https://evil.example/timeline>; rel="next"' }),
	]);
	await expect(waitForActivity(pr, {}, fixture.deps)).rejects.toThrow("pagination URL");
	expect(fixture.calls).toHaveLength(4);
});

test("malformed and wrong-PR cursors fail without requests", async () => {
	const first = setup([pull(), response([pushed()]), response([reviewed()])]);
	const other = cursor(await waitForActivity(pr, {}, first.deps));
	for (const point of ["q1.garbage", other]) {
		const fixture = setup([]);
		await expect(waitForActivity({ ...pr, number: 2 }, { since: point }, fixture.deps)).rejects.toThrow(
			"invalid --since cursor",
		);
		expect(fixture.calls).toEqual([]);
	}
});

test("PR URL parsing and timeout usage fail before authentication", () => {
	expect(pullRequest("https://github.com/example/project/pull/123", ".")).toEqual({
		owner: "example",
		repo: "project",
		number: 123,
	});
	expect(() => pullRequest("https://evil.example/example/project/pull/1", ".")).toThrow("GitHub pull request");
	for (const timeout of ["0", "-1", "NaN", "Infinity", "2147484"]) {
		const output = { stdout: () => {}, stderr: () => {} };
		expect(main(["wait", "1", "--timeout", timeout], output)).toBe(2);
	}
});

test("a push racing initial setup is not swallowed by the baseline", async () => {
	const fixture = setup([pull(), response([pushed()]), response([committed(A), committed(B)])]);
	const lines = await waitForActivity(pr, {}, fixture.deps);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatch(new RegExp(`^${B} committed `));
	expect(fixture.sleeps).toEqual([]);
});

test("a changed head during the commit listing fails rather than swallowing a push", async () => {
	const fixture = setup([pull()], [A, B]);
	await expect(waitForActivity(pr, {}, fixture.deps)).rejects.toThrow("head changed during setup");
	expect(fixture.calls).toHaveLength(2);
});

test("malformed timestamps and unexpected 304 responses fail without phantom activity", async () => {
	const invalid = setup([]);
	await expect(waitForActivity(pr, { since: "yesterday" }, invalid.deps)).rejects.toThrow("invalid timestamp");
	expect(invalid.calls).toHaveLength(0);
	const cached = setup([pull(), response([pushed()]), response(null, {}, 304)]);
	await expect(waitForActivity(pr, {}, cached.deps)).rejects.toThrow("without a cached response");
});
