// `quest land` against the shared fake GitHub and local git repositories
// standing in for github.com, so every push and lease is real git.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test } from "vitest";

import { ACTIONS_APP, type Pull, type World, fakeGitHub } from "../cloudflare/dev/github";
import type { GitHubDependencies } from "../src/cli/github";
import {
	type Plan,
	UPHELD,
	UPHELD_CLASSIC,
	checkQueue,
	parsePlan,
	parseResult,
	pin,
	pushQueue,
	resolveQueue,
} from "../src/cli/land";
import { type Output, main } from "../src/cli/main";
import { tempDir } from "./fixture";

const bin = fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url));
const bunfig = fileURLToPath(new URL("../bunfig.toml", import.meta.url));
const REPOSITORY = { owner: "upstream", repo: "project" };
const RUN = "https://github.com/upstream/project/actions/runs/9";
/** The check: a file named `broken` fails it, unless a file named `fixed` is there too. */
const CHECK = ["sh", "-c", "test ! -e broken || test -e fixed"];

const PATH = process.env.PATH;
/** Each directory `quest` ran in, one per line. */
let ran = "";
beforeEach(() => {
	// The merge driver runs `quest resolve` from PATH, as in CI.
	const tools = tempDir();
	ran = join(tools, "ran");
	writeFileSync(join(tools, "quest"), `#!/bin/sh\npwd >> '${ran}'\nexec bun --config='${bunfig}' '${bin}' "$@"\n`);
	chmodSync(join(tools, "quest"), 0o755);
	process.env.PATH = `${tools}:${PATH}`;
});

function lines(text: string): string[] {
	return text.split("\n").filter((line) => line !== "");
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const EPIC = (entries: string[]) =>
	`# Epic\n\n## Goal\n\nAn epic.\n\n## Required\n\n${entries.map((entry) => `- [${entry}](/quest/m0/${entry}.md)`).join("\n")}\n`;

/**
 * github.com as local bare repositories: `upstream/project`, a fork for each
 * contributor, and a clone per CI job that reaches them through
 * `https://github.com/` URLs.
 */
class Forge {
	readonly dir = tempDir();
	readonly hub = join(this.dir, "github");
	readonly origin = join(this.hub, "upstream", "project.git");
	private readonly work = join(this.dir, "work");
	/** PR number to its head, as GitHub's `refs/pull/<n>/head`. */
	readonly world: World;
	private nextPull = 1;

	constructor() {
		mkdirSync(this.origin, { recursive: true });
		git(this.origin, "init", "--quiet", "--bare", "--initial-branch=main");
		git(this.dir, "init", "--quiet", "--initial-branch=main", this.work);
		this.configure(this.work);
		git(this.work, "remote", "add", "origin", "https://github.com/upstream/project.git");
		this.write({
			".gitattributes": "quest/** merge=quest\n",
			"quest/README.md": "# Quests\n\n## Goal\n\nRoot.\n\n## Required\n\n- [M0](/quest/m0/README.md)\n",
			"quest/m0/README.md": EPIC(["a"]),
			"quest/m0/a.md": "# [S] A\n\n## Goal\n\nA.\n",
			"code.txt": "one\ntwo\nthree\n",
		});
		git(this.work, "add", ".");
		git(this.work, "commit", "--quiet", "-m", "base");
		git(this.work, "push", "--quiet", "origin", "HEAD:refs/heads/main");
		this.world = {
			app: { id: 1, slug: "gate" },
			installation: 5,
			forkInstallation: 6,
			forks: "service-forks",
			users: [{ id: 1, login: "maintainer", name: "Maintainer", email: "maintainer@example.test" }],
			repos: [
				{
					id: 10,
					owner: "upstream",
					name: "project",
					maintainers: ["maintainer"],
					files: [],
					issues: [],
					pulls: [],
					branches: { main: this.main() },
					fork: {},
					commits: {},
					trees: {},
					required: ["quest land", "test"],
				},
			],
		};
	}

	get repo() {
		return this.world.repos[0];
	}

	/** Route github.com URLs to the local bare repositories, and give commits an identity. */
	configure(dir: string): void {
		git(dir, "config", `url.${this.hub}/.insteadOf`, "https://github.com/");
		git(dir, "config", "user.name", "Gate");
		git(dir, "config", "user.email", "gate@example.test");
	}

	/** A fresh clone of upstream, as a CI job checks out. */
	clone(): string {
		const dir = join(this.dir, `clone-${Math.random().toString(36).slice(2)}`);
		git(this.dir, "clone", "--quiet", this.origin, dir);
		this.configure(dir);
		git(dir, "remote", "set-url", "origin", "https://github.com/upstream/project.git");
		return dir;
	}

	main(): string {
		return git(this.origin, "rev-parse", "refs/heads/main");
	}

	ref(repository: string, ref: string): string {
		return git(join(this.hub, `${repository}.git`), "rev-parse", ref);
	}

	private write(files: Record<string, string>): void {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(this.work, path, ".."), { recursive: true });
			writeFileSync(join(this.work, path), content);
		}
	}

	/**
	 * Open a PR whose branch writes `files` on the current
	 * base, and queue it as `quest merge --land` does. A `contributor` opens it
	 * from their own fork.
	 */
	pull(
		title: string,
		files: Record<string, string>,
		options: { contributor?: string; edits?: boolean; pull?: Partial<Pull> } = {},
	): Pull {
		const number = this.nextPull++;
		const branch = `topic-${number}`;
		git(this.work, "checkout", "--quiet", "-B", branch, this.main());
		this.write(files);
		git(this.work, "add", "--all");
		git(
			this.work,
			"-c",
			"user.name=Author",
			"-c",
			"user.email=author@example.test",
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			title,
			"-m",
			"Co-Authored-By: Helper <helper@example.test>",
		);
		const head = git(this.work, "rev-parse", "HEAD");
		if (options.contributor) {
			const fork = join(this.hub, options.contributor, "project.git");
			mkdirSync(fork, { recursive: true });
			spawnSync("git", ["init", "--quiet", "--bare", fork]);
			git(this.work, "push", "--quiet", fork, `${head}:refs/heads/${branch}`);
		} else {
			git(this.work, "push", "--quiet", "origin", `${head}:refs/heads/${branch}`);
		}
		// GitHub keeps every PR's head in the upstream, forks' included.
		git(this.work, "push", "--quiet", "origin", `${head}:refs/pull/${number}/head`);
		const pull: Pull = {
			number,
			title,
			author: "author",
			branch,
			head,
			checks: "SUCCESS",
			runs: [{ name: "test", conclusion: "SUCCESS", url: "https://ci.test/1" }],
			review: null,
			labels: ["quest:merge"],
			landing: true,
			autoMerge: { enabledAt: `2026-10-26T00:00:0${number}Z`, commitBody: pin(head) },
			contributor: options.contributor,
			maintainerCanModify: options.edits,
			...options.pull,
		};
		this.repo.pulls.push(pull);
		return pull;
	}

	/**
	 * GitHub catching up on pushes, before it answers a request: each open PR's
	 * head is its branch's tip, unless `lag` requests remain before it syncs.
	 */
	lag = 0;
	private sync(): void {
		if (this.lag > 0) {
			this.lag--;
			return;
		}
		for (const pull of this.repo.pulls) {
			if (pull.closed) continue;
			const holder = pull.contributor ? `${pull.contributor}/project` : "upstream/project";
			const tip = spawnSync(
				"git",
				["-C", join(this.hub, `${holder}.git`), "rev-parse", `refs/heads/${pull.branch}`],
				{
					encoding: "utf8",
				},
			);
			if (tip.status === 0) pull.head = tip.stdout.trim();
		}
	}

	/** GitHub's view after a landing: a PR whose head it had synced and that reached main merged. */
	settle(): void {
		const main = this.main();
		this.repo.branches.main = main;
		for (const pull of this.repo.pulls) {
			if (
				!pull.closed &&
				spawnSync("git", ["-C", this.origin, "merge-base", "--is-ancestor", pull.head!, main]).status === 0
			) {
				pull.closed = pull.merged = true;
			}
		}
	}

	/** A token for the gate, with `permissions` beyond reading and writing the queue. */
	async deps(permissions: Record<string, string> = {}): Promise<GitHubDependencies> {
		const fetch = fakeGitHub(this.world);
		const minted = await fetch("https://api.github.com/app/installations/5/access_tokens", {
			method: "POST",
			headers: { Authorization: "Bearer a.b.c" },
			body: JSON.stringify({
				repositories: ["project"],
				permissions: {
					contents: "write",
					pull_requests: "write",
					issues: "write",
					metadata: "read",
					...permissions,
				},
			}),
		});
		const { token } = (await minted.json()) as { token: string };
		// The fake refuses a method call, as workerd's fetch does; the CLI calls it as one.
		let clock = 0;
		return {
			fetch: (input, init) => {
				this.sync();
				return fetch(input, init);
			},
			now: () => clock,
			sleep: async (milliseconds) => {
				clock += milliseconds;
			},
			token,
			warn: () => undefined,
		};
	}

	/** One run of the gate: resolve, check in one clone, and push from another. */
	async round(): Promise<{ plan: Plan; checked: number[][]; landing: string[] }> {
		const deps = await this.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(this.clone(), plan, CHECK, () => undefined);
		const landing = await pushQueue(this.clone(), plan, result, RUN, deps);
		this.settle();
		return { plan, checked: result.checks.map((tested) => tested.numbers), landing };
	}

	comment(number: number): string | undefined {
		return this.repo.pulls.find((pull) => pull.number === number)?.comments?.at(-1)?.body;
	}
}

// The fake `quest` on PATH is a shell script, as the merge driver tests' is.
describe.skipIf(process.platform === "win32")("quest land", () => {
	test("lands the queue as one chain of squash commits, each PR's branch at its own", async () => {
		const forge = new Forge();
		const base = forge.main();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const two = forge.pull("Add c", { "c.txt": "c\n" });
		const { plan, checked, landing } = await forge.round();
		expect(plan.queue.map((entry) => entry.number)).toEqual([1, 2]);
		expect(checked).toEqual([[1, 2]]);
		const tip = forge.main();
		expect(landing).toEqual([`landed 1 ${forge.ref("upstream/project", "topic-1")}`, `landed 2 ${tip}`]);
		expect(git(forge.origin, "rev-parse", `${tip}~2`)).toBe(base);
		expect(forge.ref("upstream/project", "topic-2")).toBe(tip);
		expect(git(forge.origin, "log", "--format=%an <%ae>%n%B", "-1", "topic-1")).toBe(
			"Author <author@example.test>\nAdd b (#1)\n\n* Add b\n\nCo-authored-by: Helper <helper@example.test>",
		);
		expect([one.merged, two.merged]).toEqual([true, true]);
	});

	test("resolves quest files with the merge driver and ejects a conflict elsewhere", async () => {
		const forge = new Forge();
		forge.pull("Add b quest", {
			"quest/m0/README.md": EPIC(["a", "b"]),
			"quest/m0/b.md": "# [S] B\n\n## Goal\n\nB.\n",
		});
		forge.pull("Add c quest", {
			"quest/m0/README.md": EPIC(["a", "c"]),
			"quest/m0/c.md": "# [S] C\n\n## Goal\n\nC.\n",
		});
		forge.pull("Two is 2", { "code.txt": "one\n2\nthree\n" });
		const clash = forge.pull("Two is II", { "code.txt": "one\nII\nthree\n" });
		const { checked, landing } = await forge.round();
		expect(checked).toEqual([[1, 2, 3]]);
		expect(landing.slice(0, 1)).toEqual(["ejected 4 merge_conflict"]);
		expect(landing.slice(1).map((line) => line.split(" ")[1])).toEqual(["1", "2", "3"]);
		expect(git(forge.origin, "show", "main:quest/m0/README.md")).toBe(EPIC(["a", "b", "c"]).trim());
		expect(clash.landing).toBe(false);
		// The ejected PR keeps its merge pick for the next `quest merge`.
		expect(clash.labels).toEqual(["quest:merge"]);
		expect(forge.comment(4)).toContain("in code.txt");
		expect(forge.comment(4)).toContain(`([run](${RUN}))`);
		expect(forge.comment(4)).toMatch(/<!-- quest land: merge_conflict -->$/);
	});

	test("bisects by prefix: a passing prefix lands at once, and a PR failing alone is ejected", async () => {
		const forge = new Forge();
		forge.pull("One", { "1.txt": "1\n" });
		forge.pull("Two", { "2.txt": "2\n" });
		forge.pull("Break", { broken: "\n" });
		forge.pull("Four", { "4.txt": "4\n" });
		const first = await forge.round();
		expect(first.checked).toEqual([
			[1, 2, 3, 4],
			[1, 2],
		]);
		expect(first.landing.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["landed 1", "landed 2"]);

		const second = await forge.round();
		expect(second.plan.queue.map((entry) => entry.number)).toEqual([3, 4]);
		expect(second.checked).toEqual([[3, 4], [3]]);
		expect(second.landing).toEqual(["ejected 3 failed_checks"]);
		expect(forge.comment(3)).toContain("failed with it alone on the base");

		const third = await forge.round();
		expect(third.checked).toEqual([[4]]);
		expect(third.landing).toEqual([`landed 4 ${forge.main()}`]);
		expect(git(forge.origin, "ls-tree", "--name-only", "main")).not.toContain("broken");
	});

	test("a moved head stops the landing, and an earlier prefix never checked alone does not land", async () => {
		const forge = new Forge();
		const base = forge.main();
		// A fails alone, but B fixes it, so only A+B is checked and it passes.
		forge.pull("A", { broken: "\n" });
		const b = forge.pull("B", { fixed: "\n" });
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		expect(result.checks.map((tested) => [tested.numbers, tested.passed])).toEqual([[[1, 2], true]]);
		const moved = git(
			forge.origin,
			"-c",
			"user.name=Late",
			"-c",
			"user.email=late@example.test",
			"commit-tree",
			"-p",
			b.head!,
			"-m",
			"late",
			`${b.head}^{tree}`,
		);
		git(forge.origin, "update-ref", "refs/heads/topic-2", moved);
		expect(await pushQueue(forge.clone(), plan, result, undefined, deps)).toEqual(["ejected 2 head_moved"]);
		expect(forge.main()).toBe(base);
		expect(forge.ref("upstream/project", "topic-1")).toBe(forge.repo.pulls[0].head);
	});

	test("moves a fork's branch when it allows maintainer edits, and ejects one that does not", async () => {
		const forge = new Forge();
		const shut = forge.pull("Shut", { "s.txt": "s\n" }, { contributor: "closed" });
		forge.pull("Open", { "o.txt": "o\n" }, { contributor: "friend", edits: true });
		const { plan, landing } = await forge.round();
		expect(plan.eject.map((ejected) => [ejected.number, ejected.reason])).toEqual([[1, "no_maintainer_edits"]]);
		expect(landing).toEqual(["ejected 1 no_maintainer_edits", `landed 2 ${forge.main()}`]);
		expect(forge.ref("friend/project", "topic-2")).toBe(forge.main());
		expect(forge.ref("closed/project", "topic-1")).toBe(shut.head);
	});

	test("a failed landing push moves fork branches back, so they stay queued", async () => {
		const forge = new Forge();
		const open = forge.pull("Open", { "o.txt": "o\n" }, { contributor: "friend", edits: true });
		const head = open.head;
		const base = forge.main();
		const hook = join(forge.origin, "hooks", "pre-receive");
		writeFileSync(hook, "#!/bin/sh\necho 'main is frozen' >&2\nexit 1\n");
		chmodSync(hook, 0o755);
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		await expect(pushQueue(forge.clone(), plan, result, undefined, deps)).rejects.toThrow(/main is frozen/);
		expect(forge.main()).toBe(base);
		expect(forge.ref("friend/project", "topic-1")).toBe(head);
		expect(open.landing).toBe(true);
	});

	test("pushes the base only once GitHub shows every moved head, so each PR merges", async () => {
		const forge = new Forge();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const two = forge.pull("Add c", { "c.txt": "c\n" });
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		forge.lag = 3;
		const landing = await pushQueue(forge.clone(), plan, result, RUN, deps);
		forge.settle();
		expect(landing.map((line) => line.split(" ")[0])).toEqual(["landed", "landed"]);
		expect([one.merged, two.merged]).toEqual([true, true]);
	});

	test("lands nothing and moves heads back when GitHub never shows them", async () => {
		const forge = new Forge();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const head = one.head;
		const base = forge.main();
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		forge.lag = Infinity;
		await expect(pushQueue(forge.clone(), plan, result, RUN, deps)).rejects.toThrow(
			"GitHub did not show the moved heads",
		);
		expect(forge.main()).toBe(base);
		expect(forge.ref("upstream/project", "topic-1")).toBe(head);
		expect(one.landing).toBe(true);
	});

	test("runs the merge driver outside the chain, where a queued PR's runtime config cannot reach it", async () => {
		const forge = new Forge();
		forge.pull("Preload", {
			"bunfig.toml": 'preload = ["./evil.ts"]\n',
			".env": "BUN_OPTIONS=--preload=./evil.ts\n",
			"evil.ts": "throw new Error('PR code ran');\n",
			"quest/m0/README.md": EPIC(["a", "b"]),
			"quest/m0/b.md": "# [S] B\n\n## Goal\n\nB.\n",
		});
		forge.pull("Add c quest", {
			"quest/m0/README.md": EPIC(["a", "c"]),
			"quest/m0/c.md": "# [S] C\n\n## Goal\n\nC.\n",
		});
		const { landing } = await forge.round();
		expect(landing.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["landed 1", "landed 2"]);
		const dirs = lines(readFileSync(ran, "utf8")).filter((dir) => dir.endsWith(".git"));
		// Once in check and once in push, each from its clone's git directory.
		expect(dirs).toHaveLength(2);
		expect(lines(readFileSync(ran, "utf8")).some((dir) => dir.includes("quest-land"))).toBe(false);
	});

	test("lands only PRs still queued as they were when checked", async () => {
		const forge = new Forge();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const two = forge.pull("Add c", { "c.txt": "c\n" });
		const base = forge.main();
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		one.review = "CHANGES_REQUESTED";
		two.landing = false;
		const landing = await pushQueue(forge.clone(), plan, result, RUN, deps);
		forge.settle();
		// Only the whole chain was checked, so nothing before #1 can land either.
		expect(landing).toEqual(["ejected 1 changes_requested"]);
		expect(forge.main()).toBe(base);
		expect([one.merged, two.merged]).toEqual([undefined, undefined]);
	});

	test("reports a PR withdrawn while checked, so the rest gets another run", async () => {
		const forge = new Forge();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const two = forge.pull("Add c", { "c.txt": "c\n" });
		const base = forge.main();
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		one.landing = false;
		expect(await pushQueue(forge.clone(), plan, result, RUN, deps)).toEqual(["withdrawn 1"]);
		forge.settle();
		expect(forge.main()).toBe(base);
		expect([one.merged, two.merged]).toEqual([undefined, undefined]);
		const next = await resolveQueue(REPOSITORY, undefined, deps);
		expect(next.queue.map((entry) => entry.number)).toEqual([2]);
	});

	test("moves heads back when reading them fails", async () => {
		const forge = new Forge();
		const one = forge.pull("Add b", { "b.txt": "b\n" });
		const head = one.head;
		const base = forge.main();
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		const offline: GitHubDependencies = {
			...deps,
			fetch: (input, init) =>
				String(init?.body).includes("{ headRefOid }")
					? Promise.reject(new Error("offline"))
					: deps.fetch(input, init),
		};
		await expect(pushQueue(forge.clone(), plan, result, RUN, offline)).rejects.toThrow("offline");
		expect(forge.main()).toBe(base);
		expect(forge.ref("upstream/project", "topic-1")).toBe(head);
	});

	test("ejects auto-merging PRs that are not queued or not ready, in enqueue order", async () => {
		const forge = new Forge();
		forge.pull(
			"Unpinned",
			{ "1.txt": "1\n" },
			{ pull: { autoMerge: { enabledAt: "2026-10-26T00:00:09Z", commitBody: "" } } },
		);
		const moved = forge.pull("Moved", { "2.txt": "2\n" });
		moved.autoMerge = { ...moved.autoMerge!, commitBody: pin("f".repeat(40)) };
		forge.pull("Unreviewed", { "3.txt": "3\n" }, { pull: { review: "REVIEW_REQUIRED" } });
		forge.pull("Red", { "4.txt": "4\n" }, { pull: { runs: [{ name: "test", conclusion: "FAILURE", url: "u" }] } });
		forge.pull("Running", { "5.txt": "5\n" }, { pull: { runs: [] } });
		forge.pull("Ready", { "6.txt": "6\n" });
		forge.pull("Not landing", { "7.txt": "7\n" }, { pull: { landing: false } });
		const plan = await resolveQueue(REPOSITORY, "main", await forge.deps());
		expect(plan.queue.map((entry) => entry.number)).toEqual([6]);
		expect(plan.eject.map((ejected) => [ejected.number, ejected.reason])).toEqual([
			[2, "head_moved"],
			[3, "review_required"],
			[4, "failed_checks"],
			[5, "checks_pending"],
			[1, "not_pinned"],
		]);
	});

	test("refuses a base that does not require the quest land check", async () => {
		const forge = new Forge();
		forge.repo.required = ["test"];
		await expect(resolveQueue(REPOSITORY, undefined, await forge.deps())).rejects.toThrow(
			"does not require the quest land check",
		);
	});

	test("reads every page of a head's checks", async () => {
		const forge = new Forge();
		const other = (count: number) =>
			Array.from({ length: count }, (_, index) => ({ name: `job ${index}`, conclusion: "SUCCESS", url: "u" }));
		forge.pull(
			"Late pass",
			{ "1.txt": "1\n" },
			{ pull: { runs: [...other(250), { name: "test", conclusion: "SUCCESS", url: "u" }] } },
		);
		forge.pull(
			"Late fail",
			{ "2.txt": "2\n" },
			{
				pull: {
					runs: [
						{ name: "test", conclusion: "SUCCESS", url: "u" },
						...other(150),
						{ name: "test", conclusion: "FAILURE", url: "u" },
					],
				},
			},
		);
		forge.pull("Missing", { "3.txt": "3\n" }, { pull: { runs: other(201) } });
		const plan = await resolveQueue(REPOSITORY, "main", await forge.deps());
		expect(plan.queue.map((entry) => entry.number)).toEqual([1]);
		expect(plan.eject.map((ejected) => [ejected.number, ejected.reason])).toEqual([
			[2, "failed_checks"],
			[3, "checks_pending"],
		]);
	});

	test("counts a required check only from the app its rule names", async () => {
		const forge = new Forge();
		forge.repo.rules = [
			{
				type: "required_status_checks",
				ruleset_id: 3,
				parameters: { required_status_checks: [{ context: "lint", integration_id: 99 }] },
			},
		];
		const lint = (run: Partial<NonNullable<Pull["runs"]>[number]>) => ({
			pull: {
				runs: [
					{ name: "test", conclusion: "SUCCESS", url: "u" },
					{ name: "lint", conclusion: "SUCCESS", url: "u", ...run },
				],
			},
		});
		forge.pull("Pinned app", { "1.txt": "1\n" }, lint({ app: 99 }));
		forge.pull("Other app", { "2.txt": "2\n" }, lint({ app: ACTIONS_APP }));
		forge.pull("Status", { "3.txt": "3\n" }, lint({ context: true }));
		const plan = await resolveQueue(REPOSITORY, "main", await forge.deps());
		expect(plan.queue.map((entry) => entry.number)).toEqual([1]);
		expect(plan.eject.map((ejected) => [ejected.number, ejected.reason])).toEqual([
			[2, "checks_pending"],
			[3, "checks_pending"],
		]);
		expect(plan.eject[0].detail).toContain("lint (from app 99)");
	});

	test("refuses ruleset rules it does not uphold before reading the queue", async () => {
		const forge = new Forge();
		forge.pull("Ready", { "1.txt": "1\n" });
		forge.repo.rules = [
			{ type: "deletion", ruleset_id: 1, parameters: null },
			{ type: "non_fast_forward", ruleset_id: 1, parameters: null },
			{
				type: "pull_request",
				ruleset_id: 2,
				parameters: { required_approving_review_count: 1, require_code_owner_review: true },
			},
		];
		expect((await resolveQueue(REPOSITORY, "main", await forge.deps())).queue).toHaveLength(1);
		forge.repo.rules.push(
			{
				type: "workflows",
				ruleset_id: 4,
				parameters: { workflows: [{ path: ".github/workflows/ci.yml", repository_id: 10 }] },
			},
			{
				type: "pull_request",
				ruleset_id: 5,
				parameters: { required_review_thread_resolution: true, allowed_merge_methods: ["merge"] },
			},
		);
		const refused = resolveQueue(REPOSITORY, "main", await forge.deps());
		await expect(refused).rejects.toThrow(
			"workflows from ruleset 4; pull_request (allowed_merge_methods without squash) from ruleset 5",
		);
		await expect(refused).rejects.toThrow(`It upholds only ${Object.keys(UPHELD).join(", ")}`);
		expect(forge.repo.pulls[0].landing).toBe(true);
	});

	test("refuses an update rule rather than widening who can move the base", async () => {
		const forge = new Forge();
		forge.pull("Ready", { "1.txt": "1\n" });
		forge.repo.rules = [{ type: "update", ruleset_id: 7, parameters: null }];
		await expect(resolveQueue(REPOSITORY, "main", await forge.deps())).rejects.toThrow("update from ruleset 7");
		expect(forge.repo.pulls[0].landing).toBe(true);
	});

	test("enforces classic protection's checks and conversation resolution", async () => {
		const forge = new Forge();
		forge.repo.protection = {
			url: "https://api.github.com/repos/upstream/project/branches/main/protection",
			required_status_checks: { strict: true, contexts: ["lint"], checks: [{ context: "lint", app_id: 99 }] },
			required_pull_request_reviews: {
				dismiss_stale_reviews: true,
				require_code_owner_reviews: true,
				required_approving_review_count: 1,
				require_last_push_approval: false,
			},
			required_signatures: { enabled: false },
			enforce_admins: { enabled: false },
			required_linear_history: { enabled: true },
			required_conversation_resolution: { enabled: true },
			lock_branch: { enabled: false },
		};
		const runs = (lint: boolean) => [
			{ name: "test", conclusion: "SUCCESS", url: "u" },
			...(lint ? [{ name: "lint", conclusion: "SUCCESS", url: "u", app: 99 }] : []),
		];
		const thread = (resolved: boolean) => ({ path: "1.txt", line: 1, resolved, comments: [] });
		forge.pull("Ready", { "1.txt": "1\n" }, { pull: { runs: runs(true), threads: [thread(true)] } });
		forge.pull("Unchecked", { "2.txt": "2\n" }, { pull: { runs: runs(false) } });
		forge.pull("Unresolved", { "3.txt": "3\n" }, { pull: { runs: runs(true), threads: [thread(false)] } });
		forge.pull("Unreviewed", { "4.txt": "4\n" }, { pull: { runs: runs(true), review: "REVIEW_REQUIRED" } });
		const plan = await resolveQueue(REPOSITORY, "main", await forge.deps({ administration: "read" }));
		expect(plan.queue.map((entry) => entry.number)).toEqual([1]);
		expect(plan.eject.map((ejected) => [ejected.number, ejected.reason])).toEqual([
			[2, "checks_pending"],
			[3, "unresolved_conversations"],
			[4, "review_required"],
		]);
	});

	test("refuses classic protection settings it does not uphold, or cannot read", async () => {
		const forge = new Forge();
		forge.pull("Ready", { "1.txt": "1\n" });
		forge.repo.protection = {
			required_pull_request_reviews: { required_approving_review_count: 1, require_last_push_approval: true },
			required_signatures: { enabled: true },
			enforce_admins: { enabled: true },
			restrictions: { users: [], teams: [], apps: [] },
			allow_force_pushes: { enabled: true },
		};
		await expect(resolveQueue(REPOSITORY, "main", await forge.deps())).rejects.toThrow(
			'needs administration read (a GitHub App\'s "Administration: read", or a token with admin rights): GitHub HTTP 403',
		);
		const refused = resolveQueue(REPOSITORY, "main", await forge.deps({ administration: "read" }));
		await expect(refused).rejects.toThrow(
			"required_pull_request_reviews (require_last_push_approval), required_signatures, enforce_admins, restrictions.",
		);
		await expect(refused).rejects.toThrow(`It upholds only ${Object.keys(UPHELD_CLASSIC).join(", ")}`);
		expect(forge.repo.pulls[0].landing).toBe(true);
	});

	test("refuses a check result for any other chain", async () => {
		const forge = new Forge();
		forge.pull("One", { "1.txt": "1\n" });
		const deps = await forge.deps();
		const plan = await resolveQueue(REPOSITORY, undefined, deps);
		const result = await checkQueue(forge.clone(), plan, CHECK, () => undefined);
		const forged = { ...result, checks: [{ ...result.checks[0], tree: "0".repeat(40) }] };
		await expect(pushQueue(forge.clone(), plan, forged, undefined, deps)).rejects.toThrow("tested another tree");
		await expect(pushQueue(forge.clone(), plan, { ...result, checks: [] }, undefined, deps)).rejects.toThrow(
			"nothing was checked",
		);
		expect(() => parseResult(JSON.stringify({ base: plan.base.sha, checks: [{ numbers: ["1"] }] }))).toThrow();
		expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
	});

	test("check runs the command after -- and prints the result as JSON", async () => {
		const forge = new Forge();
		forge.pull("One", { "1.txt": "1\n" });
		const plan = await resolveQueue(REPOSITORY, undefined, await forge.deps());
		const file = join(forge.dir, "plan.json");
		writeFileSync(file, JSON.stringify(plan));
		let stdout = "";
		let stderr = "";
		const out: Output = { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) };
		const clone = forge.clone();
		expect(
			await main(["--root", clone, "land", "check", file, "--", "sh", "-c", "echo checking; exit 3"], out),
		).toBe(0);
		const result = parseResult(stdout);
		expect(result.checks.map((tested) => [tested.numbers, tested.passed])).toEqual([[[1], false]]);
		expect(stderr).toContain("checking\n");
	});
});
