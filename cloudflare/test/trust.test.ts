import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Commit, type Repo, type World, fakeGitHub, intercept } from "../dev/github";
import { GitHubService } from "../src/github/service";
import * as store from "../src/jobs/store";
import { verify as verifyAssignment } from "../src/jobs/trust";
import { privateKey } from "./github-key";

const db = env.DB;
const base = "a".repeat(40);
const head = "b".repeat(40);
const tree = "c".repeat(40);
const repository = { id: 10, owner: "upstream", name: "project" };
const signature = (login = "maintainer", databaseId = 7) => ({ isValid: true, signer: { login, databaseId } });
const commit = (parents = [base]): Commit => ({ parents, tree, message: "Change", signature: signature() });
let repo: Repo;
let github: typeof fetch;
const service = () => new GitHubService({ ...env, GITHUB_APP_PRIVATE_KEY: privateKey });
const trusted = (revision = head) => service().jobTrust(repository, "pulls/2", revision);

beforeEach(async () => {
	repo = {
		...repository,
		maintainers: ["maintainer"],
		files: [],
		issues: [],
		pulls: [{ number: 2, title: "Fix", author: "maintainer", branch: "fix", checks: null, review: null }],
		branches: { main: base, fix: head },
		fork: {},
		trees: {},
		commits: { [base]: { parents: [], tree, message: "Base" }, [head]: commit() },
	};
	const world: World = {
		app: { id: Number(env.GITHUB_APP_ID), slug: "quest" },
		installation: 5,
		forkInstallation: 6,
		forks: env.GITHUB_FORK_OWNER,
		users: [
			{ id: 7, login: "maintainer", name: "Maintainer", email: "maintainer@example.test" },
			{ id: 8, login: "contributor", name: "Contributor", email: "contributor@example.test" },
		],
		repos: [repo],
	};
	github = fakeGitHub(world);
	vi.spyOn(globalThis, "fetch").mockImplementation(github);
	await db.batch([
		db.prepare(
			"INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('owner','Owner','owner@example.test',1,0,0)",
		),
		db.prepare(
			"INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('owner-github','7','github','owner',0,0)",
		),
		db.prepare(
			"INSERT INTO github_projects(id,owner,name,installation,state,enrolledBy,updatedAt) VALUES(10,'upstream','project',5,'enabled','owner',0)",
		),
	]);
});
afterEach(() => vi.restoreAllMocks());

async function queued() {
	return (
		await store.createJob(
			db,
			{
				repository: repo.id,
				actor: "owner",
				workflow: "iterate",
				target: "pulls/2",
				revision: head,
				branch: "fix",
				trusted: await trusted(),
			},
			0,
		)
	).id;
}

async function runner(name: string, platform: store.Platform, vm = false) {
	const { id } = await store.createRunner(db, "owner", name, platform, vm, 0);
	const machine = { id, owner: "owner", name, platform, vm: vm ? 1 : 0 };
	await store.report(
		db,
		machine,
		[{ id: "account", provider: "anthropic", kind: "subscription", label: name, limited: false }],
		[],
		0,
	);
	return machine;
}

const dispatch = (machines: store.Runner[]) =>
	store.dispatch(db, "owner", new Map(machines.map((r) => [r.id, 1])), 1, (job) =>
		verifyAssignment({ ...env, GITHUB_APP_PRIVATE_KEY: privateKey }, job),
	);

describe("authenticated PR provenance", () => {
	it("routes a maintainer-signed head to an ordinary macOS runner", async () => {
		const id = await queued();
		const mac = await runner("mac", "darwin");
		expect((await dispatch([mac])).assign).toMatchObject([{ runner: mac.id, job: { id, trusted: 1 } }]);
	});

	it("requires every commit, including the parents of a signed merge, to be authenticated", async () => {
		const other = "d".repeat(40);
		repo.commits[other] = { ...commit(), signature: signature("contributor", 8) };
		repo.commits[head]!.parents = [base, other];
		expect(await trusted()).toBe(false);
	});

	it("does not let a retargeted PR hide an unsigned ancestor under its signed head", async () => {
		const hidden = "d".repeat(40);
		repo.commits[hidden] = { ...commit(), signature: null };
		repo.branches.feature = hidden;
		repo.pulls[0]!.base = "feature";
		repo.commits[head]!.parents = [hidden];
		expect(await trusted()).toBe(false);
		// A non-default PR base itself does not make an authenticated ancestry untrusted.
		repo.commits[hidden]!.signature = signature();
		expect(await trusted()).toBe(true);
	});

	it("trusts revisions already inherited by the repository default branch", async () => {
		repo.branches.main = head;
		repo.commits[head]!.signature = null;
		expect(await trusted()).toBe(true);
	});

	it("refuses unsigned commits and a contributor forging a maintainer's author email", async () => {
		// The PR author is a maintainer; only the signature signer proves who committed.
		repo.commits[head]!.signature = null;
		expect(await trusted()).toBe(false);
		repo.commits[head]!.signature = signature("contributor", 8);
		expect(await trusted()).toBe(false);
		repo.commits[head]!.signature = { ...signature(), isValid: false };
		expect(await trusted()).toBe(false);
	});

	it("reclassifies a queued head after a contributor pushes and routes it only to a Linux VM runner", async () => {
		const id = await queued();
		const next = "d".repeat(40);
		repo.commits[next] = { ...commit([head]), signature: signature("contributor", 8) };
		repo.branches.fix = next;
		const mac = await runner("mac", "darwin", true);
		const linux = await runner("linux", "linux");
		const vm = await runner("vm", "linux", true);
		expect((await dispatch([mac, linux, vm])).assign).toMatchObject([{ runner: vm.id, job: { id, trusted: 0 } }]);
	});

	it("rechecks current maintainer roles and leaves a revoked signer's head queued without a VM", async () => {
		const id = await queued();
		repo.maintainers = [];
		const mac = await runner("mac", "darwin");
		expect((await dispatch([mac])).assign).toEqual([]);
		expect(await store.readJob(db, id)).toMatchObject({ trusted: 0, state: "queued" });
	});

	it("pages all commits and checks a contributor beyond the first page", async () => {
		let parent = base;
		for (let i = 1; i <= 102; i++) {
			const oid = i.toString(16).padStart(40, "0");
			repo.commits[oid] = commit([parent]);
			parent = oid;
		}
		repo.branches.fix = parent;
		expect(await trusted(parent)).toBe(true);
		repo.commits["1".padStart(40, "0")]!.signature = signature("contributor", 8);
		expect(await trusted(parent)).toBe(false);
	});

	it.each(["default tip", "default name", "pull head", "comparison head", "comparison base", "commit count"])(
		"fails closed when %s changes during comparison paging",
		async (change) => {
			let parent = base;
			for (let i = 1; i <= 102; i++) {
				const oid = i.toString(16).padStart(40, "0");
				repo.commits[oid] = commit([parent]);
				parent = oid;
			}
			repo.branches.fix = parent;
			let pages = 0;
			vi.mocked(globalThis.fetch).mockImplementation(
				intercept(
					github,
					(url) => url.pathname === "/graphql" && ++pages === 2,
					async (next) => {
						const response = (await (await next()).json()) as any;
						const repository = response.data.repository;
						const branch = repository.defaultBranchRef;
						if (change === "default tip") branch.target.oid = head;
						if (change === "default name") branch.name = "release";
						if (change === "pull head") repository.pullRequest.headRefOid = head;
						if (change === "comparison head") branch.compare.headTarget.oid = head;
						if (change === "comparison base") branch.compare.baseTarget.oid = head;
						if (change === "commit count") branch.compare.commits.totalCount++;
						return Response.json(response);
					},
				),
			);
			expect(await trusted(parent)).toBe(false);
		},
	);

	it("fails closed when GitHub cannot finish paging", async () => {
		vi.mocked(globalThis.fetch).mockImplementation(
			intercept(
				github,
				(url) => url.pathname === "/graphql",
				async (next) => {
					const response = (await (await next()).json()) as any;
					response.data.repository.defaultBranchRef.compare.commits.pageInfo = {
						hasNextPage: true,
						endCursor: null,
					};
					return Response.json(response);
				},
			),
		);
		await expect(trusted()).rejects.toThrow("cursor");
	});

	it("rechecks an undelivered assignment and cancels a revoked trusted attempt", async () => {
		const id = await queued();
		const mac = await runner("mac", "darwin");
		expect((await dispatch([mac])).assign).toMatchObject([{ job: { id, trusted: 1 } }]);
		repo.maintainers = [];
		const pass = await dispatch([mac]);
		expect(pass.assign).toEqual([]);
		expect(pass.cancel).toEqual([{ runner: mac.id, job: id, attempt: 1 }]);
		expect(await store.readJob(db, id)).toMatchObject({ trusted: 0, state: "queued" });
	});

	it.each(["landed", "unconfirmed", "changed"])(
		"reassigns safely after a %s pending publication loses its response",
		async (outcome) => {
			const id = await queued();
			const first = await runner("first", "linux");
			await dispatch([first]);
			await store.report(
				db,
				first,
				[{ id: "account", provider: "anthropic", kind: "subscription", label: "First", limited: false }],
				[{ job: id, attempt: 1 }],
				1,
			);
			const pending = "d".repeat(40);
			repo.commits[pending] = { ...commit([head]), signature: null };
			await store.claim(db, first, id, 1, head, pending, 2);
			if (outcome === "landed") repo.branches.fix = pending;
			if (outcome === "changed") {
				const other = "e".repeat(40);
				repo.commits[other] = { ...commit([head]), signature: null };
				repo.branches.fix = other;
			}
			// Its disconnected runner's lease expires. Recovery must precede trust and routing.
			const verify = (job: store.AssignmentSource) =>
				verifyAssignment({ ...env, GITHUB_APP_PRIVATE_KEY: privateKey }, job);
			await store.dispatch(db, "owner", new Map(), 3, verify);
			const replacement = await runner("replacement", "darwin");
			const pass = await store.dispatch(db, "owner", new Map([[replacement.id, 1]]), store.GRACE + 4, verify);
			if (outcome === "changed") {
				expect(pass.assign).toEqual([]);
				expect(await store.readJob(db, id)).toMatchObject({ head, pending, trusted: 0, state: "queued" });
			} else {
				const expected = outcome === "landed" ? pending : head;
				expect(pass.assign).toMatchObject([
					{ runner: replacement.id, job: { id, head: expected, trusted: 1, attempt: 2 } },
				]);
				expect(await store.readJob(db, id)).toMatchObject({
					head: expected,
					pending: outcome === "landed" ? null : pending,
				});
			}
			expect((await db.prepare("SELECT sha FROM job_commits").all()).results).toEqual(
				outcome === "landed" ? [{ sha: pending }] : [],
			);
		},
	);

	it("trusts confirmed kix publications, retaining earlier commits but refusing unconfirmed and failed pushes", async () => {
		const id = await queued();
		const machine = await runner("linux", "linux");
		await dispatch([machine]);
		const published = "d".repeat(40);
		const next = "e".repeat(40);
		for (const oid of [published, next]) repo.commits[oid] = { ...commit([base]), signature: null };
		repo.branches.fix = published;
		expect(await trusted(published)).toBe(false);
		await store.claim(db, machine, id, 1, head, published, 2);
		await store.settle(db, id, published, false, 3);
		expect(await trusted(published)).toBe(false);
		await store.claim(db, machine, id, 1, head, published, 4);
		await store.settle(db, id, published, true, 5);
		expect(await trusted(published)).toBe(true);
		repo.commits[next]!.parents = [published];
		repo.branches.fix = next;
		await store.claim(db, machine, id, 1, published, next, 6);
		// A confirmed update recovered after a crash records the same provenance.
		await store.adopt(db, id, published, next, 7);
		expect(await trusted(next)).toBe(true);
		expect((await db.prepare("SELECT sha FROM job_commits ORDER BY sha").all()).results).toEqual([
			{ sha: published },
			{ sha: next },
		]);
	});
});
