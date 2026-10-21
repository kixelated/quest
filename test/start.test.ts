// `quest start` and `quest unblocked --unclaimed`: claims on local bare
// remotes, with GitHub replayed in memory. URL rewrites (`insteadOf`) let a
// github.com remote name reach a local bare repository.

import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test, vi } from "vitest";

import { claims } from "../src/cli/claims";
import { type GitHubDependencies, type ObjectValue } from "../src/cli/github";
import { type Output, main } from "../src/cli/main";
import { Refusal, ago, releaseQuest, startQuest } from "../src/cli/start";
import { TWO, Tree, tempDir } from "./fixture";

const ONE = "quest/m0/epic/one.md";
const BRANCH = "quest/m0/epic/one";
const UPSTREAM = "https://github.com/example/project.git";
const FORK = "https://github.com/me/project.git";

// Each test spawns git a few dozen times, which takes seconds on Windows runners.
vi.setConfig({ testTimeout: 30_000 });

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Identity and no signing, so commits work under any user configuration. */
const IDENTITY = "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n";

/** A new repository on main. */
function setup(dir: string): void {
	git(dir, "init", "-q", "-b", "main");
	appendFileSync(join(dir, ".git", "config"), IDENTITY);
}

/**
 * Built once and copied per test, since spawning git dominates these tests: a
 * bare repository whose main holds the baseline tree, and a clone of it.
 */
const templates = (() => {
	let built: { bare: string; clone: string } | undefined;
	const root = mkdtempSync(join(tmpdir(), "quest-start-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	return () => {
		if (built) return built;
		const bare = join(root, "bare");
		const clone = join(root, "clone");
		cpSync(Tree.baseline().path, clone, { recursive: true });
		setup(clone);
		git(clone, "add", ".");
		git(clone, "commit", "-q", "-m", "seed");
		git(root, "clone", "-q", "--bare", clone, bare);
		git(clone, "remote", "add", "origin", bare);
		git(clone, "fetch", "-q", "origin");
		git(clone, "branch", "-q", "--set-upstream-to", "origin/main");
		built = { bare, clone };
		return built;
	};
})();

/** A bare repository whose default branch holds the baseline tree. */
function upstream(): string {
	const bare = tempDir();
	cpSync(templates().bare, bare, { recursive: true });
	return bare;
}

/**
 * A clone of the baseline whose origin is `url`, rewritten to the bare
 * repositories in `routes`. Without routes, origin is a bare path.
 */
function clone(url: string, routes: Record<string, string> = {}): string {
	const dir = tempDir();
	cpSync(templates().clone, dir, { recursive: true });
	git(dir, "remote", "set-url", "origin", url);
	const rewrites = Object.entries(routes).map(([from, to]) => `[url "${to}"]\n\tinsteadOf = ${from}\n`);
	appendFileSync(join(dir, ".git", "config"), rewrites.join(""));
	return dir;
}

interface Pull {
	number: number;
	base: string;
	head: { ref: string; repo: { full_name: string } | null };
	draft: boolean;
	state: string;
	body: string;
	created_at: string;
	updated_at: string;
	html_url: string;
}

/** GitHub's repositories and pull requests, in memory. */
class FakeGitHub {
	readonly repos = new Map<string, ObjectValue>();
	readonly pulls: Pull[] = [];
	/** Runs after each PR is created, as when another claimer opens one at the same moment. */
	onCreate?: () => void;
	private clock = Date.now();

	constructor() {
		this.repo("example/project", { fork: false, default_branch: "main" });
	}

	repo(name: string, extra: ObjectValue): void {
		const [owner, repo] = name.split("/");
		this.repos.set(name, { owner: { login: owner }, name: repo, full_name: name, ...extra });
	}

	/** Open a PR as another contributor, `minutes` before now. */
	open(base: string, ref: string, headRepo: string, options: Partial<Pull> = {}): Pull {
		const number = this.pulls.length + 1;
		const pull: Pull = {
			number,
			base,
			head: { ref, repo: { full_name: headRepo } },
			draft: true,
			state: "open",
			body: "",
			created_at: new Date(this.clock++).toISOString(),
			updated_at: new Date(this.clock).toISOString(),
			html_url: `https://github.com/${base}/pull/${number}`,
			...options,
		};
		this.pulls.push(pull);
		return pull;
	}

	open_(base: string): Pull[] {
		return this.pulls.filter((pull) => pull.base === base && pull.state === "open");
	}

	deps(): GitHubDependencies {
		return {
			fetch: async (url, init) => this.handle(url, init),
			now: () => this.clock,
			sleep: async () => undefined,
			token: "token",
			warn: () => undefined,
		};
	}

	private handle(url: URL, init: RequestInit): Response {
		const method = init.method ?? "GET";
		const body = init.body ? (JSON.parse(String(init.body)) as ObjectValue) : {};
		const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
		let match = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname);
		if (match && method === "GET") {
			const repo = this.repos.get(match[1]);
			return repo ? json(200, repo) : json(404, { message: "Not Found" });
		}
		match = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(url.pathname);
		if (match && method === "GET") return json(200, this.open_(match[1]));
		if (match && method === "POST") {
			const [owner, ref] = String(body.head).includes(":") ? String(body.head).split(":") : [null, body.head];
			const headRepo = owner ? `${owner}/${match[1].split("/")[1]}` : match[1];
			const pull = this.open(match[1], String(ref), headRepo, {
				draft: body.draft === true,
				body: String(body.body),
			});
			this.onCreate?.();
			return json(201, { ...pull, title: body.title, baseRef: body.base });
		}
		match = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url.pathname);
		if (match && method === "PATCH") {
			const pull = this.pulls.find((p) => p.base === match![1] && p.number === Number(match![2]))!;
			Object.assign(pull, body);
			return json(200, pull);
		}
		return json(404, { message: `no route for ${method} ${url.pathname}` });
	}
}

function deps(github: FakeGitHub, warnings: string[] = []) {
	return { github: () => github.deps(), warn: (message: string) => warnings.push(message) };
}

/** The branch tip on a bare repository, or "" when it is missing. */
function tip(bare: string, branch = BRANCH): string {
	return git(bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);
}

/** Run the CLI and wait for it. */
async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	let stdout = "";
	let stderr = "";
	const out: Output = { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) };
	const code = await main(args, out);
	return { code, stdout, stderr };
}

describe("start on GitHub", () => {
	test("claims a free quest with an empty commit and a draft PR", async () => {
		const bare = upstream();
		const github = new FakeGitHub();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		const started = await startQuest(work, ONE, "[S] One", "origin", deps(github));

		expect(started).toEqual({ branch: BRANCH, sha: tip(bare), url: "https://github.com/example/project/pull/1" });
		const base = git(bare, "rev-parse", "main");
		expect(git(bare, "rev-parse", `${started.sha}^`)).toBe(base);
		expect(git(bare, "rev-parse", `${started.sha}^{tree}`)).toBe(git(bare, "rev-parse", `${base}^{tree}`));
		expect(git(bare, "log", "-1", "--format=%B", started.sha)).toMatch(
			/^chore\(quest\): claim quest\/m0\/epic\/one\.md\n\nQuest-Claim: [0-9a-f]{16}$/,
		);
		expect(git(work, "symbolic-ref", "HEAD")).toBe(`refs/heads/${BRANCH}`);
		expect(git(work, "rev-parse", "HEAD")).toBe(started.sha);
		expect(github.pulls).toMatchObject([
			{ base: "example/project", head: { ref: BRANCH, repo: { full_name: "example/project" } }, draft: true },
		]);
		expect(github.pulls[0].body).toContain(ONE);
	});

	test("fast-forwards the quest branch a worktree already has checked out", async () => {
		const bare = upstream();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		git(work, "switch", "-q", "-c", BRANCH);
		const warnings: string[] = [];
		const started = await startQuest(work, ONE, "[S] One", "origin", deps(new FakeGitHub(), warnings));
		expect(warnings).toEqual([]);
		expect(git(work, "rev-parse", "HEAD")).toBe(started.sha);
	});

	test("warns rather than moving a diverged local branch", async () => {
		const bare = upstream();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		git(work, "branch", BRANCH);
		const warnings: string[] = [];
		const started = await startQuest(work, ONE, "[S] One", "origin", deps(new FakeGitHub(), warnings));
		expect(warnings).toEqual([
			`local branch ${BRANCH} already exists; merge the claim commit ${started.sha} into it before pushing`,
		]);
		expect(git(work, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
	});

	test("reaches a fork's parent with the scheme a URL alias resolves to", async () => {
		const bare = upstream();
		const forkBare = tempDir();
		git(forkBare, "init", "-q", "--bare", "-b", "main");
		const github = new FakeGitHub();
		github.repo("me/project", {
			fork: true,
			default_branch: "main",
			parent: {
				owner: { login: "example" },
				name: "project",
				clone_url: UPSTREAM,
				ssh_url: "git@github.com:example/project.git",
				default_branch: "main",
			},
		});
		// `corp:me/project` expands to the fork's HTTPS URL, so the parent is read over HTTPS too.
		// The SSH form leads nowhere, so choosing it fails fast; pushes go to the fork's bare repository.
		const work = clone("corp:me/project.git", {
			[UPSTREAM]: bare,
			"git@github.com:example/project.git": join(tempDir(), "missing"),
		});
		git(work, "config", "url.https://github.com/.insteadOf", "corp:");
		git(work, "config", "remote.origin.pushurl", forkBare);
		const started = await startQuest(work, ONE, "[S] One", "origin", deps(github));
		expect(tip(forkBare)).toBe(started.sha);
	});

	test("refuses a quest whose branch is already upstream", async () => {
		const bare = upstream();
		git(bare, "branch", BRANCH, "main");
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		await expect(startQuest(work, ONE, "[S] One", "origin", deps(new FakeGitHub()))).rejects.toThrow(
			new Refusal(`${ONE} is held by branch ${BRANCH}, with no open PR`),
		);
	});

	test("refuses a quest a fork's PR claims, and says whether it was handed back", async () => {
		const bare = upstream();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		const github = new FakeGitHub();
		const pull = github.open("example/project", BRANCH, "someone/project");
		const start = () => startQuest(work, ONE, "[S] One", "origin", deps(github));

		await expect(start()).rejects.toThrow(`${ONE} is held by ${pull.html_url} (draft, last active just now)`);
		pull.body = "Work so far.\n\n## Decisions needed\n\n1. Which name?\n";
		await expect(start()).rejects.toThrow(`held by ${pull.html_url} (draft, decisions needed,`);
		pull.draft = false;
		await expect(start()).rejects.toThrow(`held by ${pull.html_url} (ready for review,`);
		expect(tip(bare)).toBe("");
	});

	test("two claimers race: one push wins and the other is refused", async () => {
		const bare = upstream();
		const github = new FakeGitHub();
		const [a, b] = [clone(UPSTREAM, { [UPSTREAM]: bare }), clone(UPSTREAM, { [UPSTREAM]: bare })];
		const results = await Promise.allSettled([
			startQuest(a, ONE, "[S] One", "origin", deps(github)),
			startQuest(b, ONE, "[S] One", "origin", deps(github)),
		]);

		const won = results.filter((result) => result.status === "fulfilled");
		const lost = results.filter((result) => result.status === "rejected");
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(Refusal);
		expect(tip(bare)).toBe((won[0] as PromiseFulfilledResult<{ sha: string }>).value.sha);
		expect(github.open_("example/project")).toHaveLength(1);
	});

	test("a fork PR opened first keeps the claim; the later PR closes and its branch goes", async () => {
		const bare = upstream();
		const github = new FakeGitHub();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		let fork: Pull | undefined;
		github.onCreate = () => {
			github.onCreate = undefined;
			fork = github.open("example/project", BRANCH, "someone/project", {
				created_at: new Date(Date.now() - 3_600_000).toISOString(),
			});
		};

		await expect(startQuest(work, ONE, "[S] One", "origin", deps(github))).rejects.toThrow(
			`${fork?.html_url ?? "https://github.com/example/project/pull/2"} claimed ${ONE} first; closed https://github.com/example/project/pull/1`,
		);
		expect(github.open_("example/project").map((pull) => pull.number)).toEqual([2]);
		expect(tip(bare)).toBe("");
	});

	test("a fork pushes to itself and opens the PR on its parent", async () => {
		const bare = upstream();
		const forkBare = tempDir();
		git(forkBare, "init", "-q", "--bare", "-b", "main");
		const github = new FakeGitHub();
		github.repo("me/project", {
			fork: true,
			default_branch: "main",
			parent: {
				owner: { login: "example" },
				name: "project",
				clone_url: UPSTREAM,
				ssh_url: "git@github.com:example/project.git",
				default_branch: "main",
			},
		});
		const work = clone(FORK, { [FORK]: forkBare, [UPSTREAM]: bare });

		const started = await startQuest(work, ONE, "[S] One", "origin", deps(github));
		expect(tip(forkBare)).toBe(started.sha);
		expect(tip(bare)).toBe("");
		expect(github.pulls).toMatchObject([
			{ base: "example/project", head: { ref: BRANCH, repo: { full_name: "me/project" } } },
		]);

		// Another clone of the upstream sees the fork's claim.
		const other = clone(UPSTREAM, { [UPSTREAM]: bare });
		await expect(startQuest(other, ONE, "[S] One", "origin", deps(github))).rejects.toThrow(Refusal);

		const released = await releaseQuest(work, ONE, "origin", deps(github));
		expect(released).toEqual({ branch: BRANCH, closed: [started.url] });
		expect(tip(forkBare)).toBe("");
	});

	test("refuses a quest missing from the upstream default branch", async () => {
		const bare = upstream();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		const extra = "quest/m0/epic/three.md";
		writeFileSync(join(work, extra), "# [S] Three\n\n## Goal\n\nOnly local.\n");
		await expect(startQuest(work, extra, "[S] Three", "origin", deps(new FakeGitHub()))).rejects.toThrow(
			new Refusal(`${extra} is not on the upstream default branch; update your checkout`),
		);
		expect(tip(bare, "quest/m0/epic/three")).toBe("");
	});

	test("release deletes the empty claim branch and closes its PR", async () => {
		const bare = upstream();
		const github = new FakeGitHub();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		const started = await startQuest(work, ONE, "[S] One", "origin", deps(github));

		expect(await releaseQuest(work, ONE, "origin", deps(github))).toEqual({
			branch: BRANCH,
			closed: [started.url],
		});
		expect(tip(bare)).toBe("");
		expect(github.pulls[0].state).toBe("closed");
	});

	test("release refuses a branch with work on it", async () => {
		const bare = upstream();
		const github = new FakeGitHub();
		const work = clone(UPSTREAM, { [UPSTREAM]: bare });
		await startQuest(work, ONE, "[S] One", "origin", deps(github));
		appendFileSync(join(work, ONE), "\nWork in progress.\n");
		git(work, "commit", "-q", "-m", "work", "--", ONE);
		git(work, "push", "-q", "origin", `refs/heads/${BRANCH}:refs/heads/${BRANCH}`);

		await expect(releaseQuest(work, ONE, "origin", deps(github))).rejects.toThrow(
			new Refusal(
				`${BRANCH} on origin has work beyond its empty claim commit; close its PR yourself to abandon that work`,
			),
		);
		expect(tip(bare)).toBe(git(work, "rev-parse", "HEAD"));
		expect(github.pulls[0].state).toBe("open");
	});
});

describe("start on another forge", () => {
	/** A clone whose origin is a plain bare repository path. */
	function plain(): { bare: string; work: string } {
		const bare = upstream();
		return { bare, work: clone(bare) };
	}

	test("pushes the claim branch without a PR, then refuses a second claim", async () => {
		const { bare, work } = plain();
		const first = await cli("--root", work, "start", ONE);
		expect(first).toEqual({
			code: 0,
			stdout: `${BRANCH}\n`,
			stderr: "quest: origin is not on GitHub, so the claim branch was pushed without a PR\n",
		});
		expect(tip(bare)).not.toBe("");

		const second = await cli("--root", work, "start", `/${ONE}`);
		expect(second.code).toBe(3);
		expect(second.stderr).toContain(`quest: ${ONE} is held by branch ${BRANCH}, with no open PR\n`);
	});

	test("claims a quest whose tree is below the repository root", async () => {
		const bare = tempDir();
		git(bare, "init", "-q", "--bare", "-b", "main");
		const work = tempDir();
		setup(work);
		mkdirSync(join(work, "sub"));
		cpSync(join(Tree.baseline().path, "quest"), join(work, "sub", "quest"), { recursive: true });
		git(work, "add", ".");
		git(work, "commit", "-q", "-m", "seed");
		git(work, "remote", "add", "origin", bare);
		git(work, "push", "-q", "origin", "HEAD:refs/heads/main");

		const out = await cli("--root", join(work, "sub"), "start", ONE);
		expect(out.code, out.stderr).toBe(0);
		expect(out.stdout).toBe(`${BRANCH}\n`);
		expect(tip(bare)).not.toBe("");
	});

	test("fails on a malformed tree before touching the remote", async () => {
		const { bare, work } = plain();
		// A misspelled `## Required` hides the blocker from the readiness check.
		writeFileSync(join(work, "quest/m0/epic/two.md"), TWO.replace("## Required", "## Requires"));
		const out = await cli("--root", work, "start", "quest/m0/epic/two.md");
		expect(out.code).toBe(1);
		expect(out.stderr).toContain("unknown '## Requires'");
		expect(tip(bare, "quest/m0/epic/two")).toBe("");
	});

	test("refuses a blocked quest with exit 3", async () => {
		const { bare, work } = plain();
		const out = await cli("--root", work, "start", "quest/m0/epic/two.md");
		expect(out.code).toBe(3);
		expect(out.stderr).toContain("quest: quest/m0/epic/two.md is blocked;");
		expect(tip(bare, "quest/m0/epic/two")).toBe("");
	});

	test("releases the claim", async () => {
		const { bare, work } = plain();
		await cli("--root", work, "start", ONE);
		expect(await cli("--root", work, "start", "--release", ONE)).toEqual({
			code: 0,
			stdout: `deleted ${BRANCH}\n`,
			stderr: "",
		});
		expect(tip(bare)).toBe("");
		expect((await cli("--root", work, "start", "--release", ONE)).code).toBe(1);
	});

	test("unblocked --unclaimed drops held quests and lists them on stderr", async () => {
		const { bare, work } = plain();
		// Two ready quests, so the filter leaves one.
		appendFileSync(join(work, "quest/m0/epic/README.md"), "- [Three](/quest/m0/epic/three.md)\n");
		writeFileSync(join(work, "quest/m0/epic/three.md"), "# [S] Three\n\n## Goal\n\nAlso ready.\n");
		git(bare, "branch", BRANCH, "main");

		expect(await cli("--root", work, "unblocked", "--unclaimed")).toEqual({
			code: 0,
			stdout: "0\tquest/m0/epic/three.md\n",
			stderr:
				"quest: origin is not on GitHub, so only its branches were checked for claims\n" +
				`quest: skipped ${ONE}: held by branch ${BRANCH}, with no open PR\n`,
		});
		expect((await cli("--root", work, "unblocked", "--unclaimed", "--remote", "nope")).stderr).toBe(
			"quest: no nope remote, so claims were not checked\n",
		);
	});
});

test("claims reports the earliest open PR on each branch", async () => {
	const bare = upstream();
	const github = new FakeGitHub();
	const work = clone(UPSTREAM, { [UPSTREAM]: bare });
	const first = github.open("example/project", BRANCH, "a/project");
	github.open("example/project", BRANCH, "b/project");
	github.open("example/project", "feature", "example/project");
	const held = await claims(work, "origin", [BRANCH, "quest/m0/epic/two"], deps(github));
	expect(held).toEqual([
		{ branch: BRANCH, url: first.html_url, pull: expect.objectContaining({ number: 1 }), sha: null },
	]);
});

test("ago rounds to minutes, hours, then days", () => {
	const now = Date.parse("2026-10-21T12:00:00Z");
	expect(ago(now, now - 10_000)).toBe("just now");
	expect(ago(now, now - 60_000)).toBe("1 minute ago");
	expect(ago(now, now - 3 * 3_600_000)).toBe("3 hours ago");
	expect(ago(now, now - 3 * 86_400_000)).toBe("3 days ago");
});
