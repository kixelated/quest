// Trusted host side: durable background jobs, validation, and credentialed publication.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MERGE_LABEL } from "../core";
import { GitHub, type GitHubDependencies, object, string } from "./github";
import { baseRemote, commandEnvironment, contains, git, pin, type Entry, type Ejection, type Plan } from "./land";
import { readFixResult, parseFixResult, type FixResult } from "./land-fix";
import { push } from "./land-head";
import { type Failure } from "./land-serve";

class FixerRefusal extends Error {}

interface Job {
	checkout: string;
	plan: Plan;
	numbers: number[];
	started: number;
	pid?: number;
	identity?: string;
	results?: FixResult[];
	error?: string;
	handbacks?: Record<number, string>;
	// Persist publication before moving a remote head; retries recognize only this exact head.
	published: number[];
}
interface Attempt {
	pick: string;
	requeued?: string;
	head?: string;
}
function save(path: string, data: unknown): void {
	writeFileSync(`${path}.new`, JSON.stringify(data), { mode: 0o600 });
	renameSync(`${path}.new`, path);
}
const attemptPath = (state: string, number: number) => join(state, `fix-attempt-${number}.json`);
function attempt(state: string, number: number): Attempt | undefined {
	const path = attemptPath(state, number);
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Attempt) : undefined;
}
function identity(pid: number): string | undefined {
	try {
		return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[19]}`;
	} catch {
		return undefined;
	}
}
async function comment(
	github: GitHub,
	plan: Plan,
	entry: Pick<Entry, "number" | "enabledAt">,
	text: string,
	suffix: string,
): Promise<void> {
	const path = `/repos/${plan.repository}/issues/${entry.number}/comments`;
	const marker = `<!-- quest land fixer: ${entry.enabledAt} ${suffix} -->`;
	if ((await github.all(`${path}?per_page=100`)).some((item) => string(item.body).includes(marker))) return;
	await github.request(path, {
		body: { body: `Codex land fixer: ${text}\n\n${marker}\n\n(written by GPT-6.1 Sol)` },
	});
}

/** Queue eligibility can eject a previously requeued PR before building another batch. */
export async function handbackRepeated(
	state: string,
	plan: Plan,
	entry: Ejection | Entry,
	deps: GitHubDependencies,
): Promise<boolean> {
	const previous = attempt(state, entry.number);
	if (!previous || (previous.pick !== entry.enabledAt && previous.requeued !== entry.enabledAt)) return false;
	await comment(
		new GitHub(deps),
		plan,
		entry,
		"This maintainer pick already used its mechanical fix attempt. Run /quest-iterate to diagnose the repeated failure, then pick it again.",
		"handback",
	);
	return true;
}

export async function startFixer(
	root: string,
	checkout: string,
	failure: Failure,
	fixer: string,
	state: string,
	deps: GitHubDependencies,
): Promise<void> {
	const entries: Entry[] = [];
	for (const entry of failure.plan.queue.filter((item) => failure.numbers.includes(item.number))) {
		// failure.json may replay after launching or collecting this same job. It is not a second pick.
		const previous = attempt(state, entry.number);
		if (
			previous?.pick === entry.enabledAt &&
			(previous.requeued ||
				readdirSync(state).some((name) => {
					if (!/^fix-job-.*\.json$/.test(name)) return false;
					const job = JSON.parse(readFileSync(join(state, name), "utf8")) as Job;
					return (
						job.numbers.includes(entry.number) &&
						job.plan.queue.some(
							(item) => item.number === entry.number && item.enabledAt === entry.enabledAt,
						)
					);
				}))
		)
			continue;

		if (await handbackRepeated(state, failure.plan, entry, deps)) {
			continue;
		} else {
			save(attemptPath(state, entry.number), { pick: entry.enabledAt });
			entries.push(entry);
		}
	}
	if (!entries.length) {
		rmSync(checkout, { recursive: true, force: true });
		return;
	}
	git(checkout, ["init", "--quiet"]);
	git(checkout, [
		"fetch",
		"--quiet",
		"--no-tags",
		"--no-write-fetch-head",
		root,
		`${failure.tip}:refs/heads/batch`,
		`${failure.plan.base.sha}:refs/heads/base`,
		...entries.map((entry) => `${entry.head}:refs/heads/pr-${entry.number}`),
	]);
	git(checkout, ["config", "user.name", "quest fixer"]);
	git(checkout, ["config", "user.email", "quest-fixer@localhost"]);
	git(checkout, ["checkout", "--quiet", "--detach", failure.tip]);
	const path = join(state, `fix-job-${checkout.split("/").at(-1)}.json`);
	const job: Job = {
		checkout,
		plan: failure.plan,
		numbers: entries.map((entry) => entry.number),
		started: deps.now(),
		published: [],
	};
	save(path, job);
	// The supervisor survives a daemon restart and atomically records the wrapper's exit status.
	// Its state path is never passed to the wrapper or mounted in its container.
	const child = spawn(
		"sh",
		[
			"-c",
			'status=$1; shift; "$@"; code=$?; printf "%s" "$code" > "$status.new"; mv "$status.new" "$status"',
			"quest-fixer",
			`${path}.exit`,
			fixer,
			failure.log,
			...job.numbers.map(String),
		],
		{ cwd: checkout, detached: true, env: commandEnvironment(), stdio: "ignore" },
	);
	try {
		await new Promise<void>((done, reject) => {
			child.once("spawn", done);
			child.once("error", reject);
		});
		job.pid = child.pid;
		job.identity = identity(child.pid!);
	} catch (error) {
		job.error = `fixer launch failed: ${String(error)}`;
	}
	save(path, job);
	child.unref();
}

/** New commits descend from the pin. Protected content/modes at the head must match pin or current base. */
export function validateFix(root: string, entry: Entry, head: string, base: string): void {
	if (!contains(root, entry.head, head) || head === entry.head)
		throw new Error("fixed head must descend from the pinned PR head");
	for (const commit of git(root, ["rev-list", head, `^${entry.head}`, `^${base}`])
		.split("\n")
		.filter(Boolean)) {
		if (!contains(root, entry.head, commit)) throw new Error("new fixer commit is not on top of pinned head");
	}
	const paths = new Set<string>();
	for (const ref of [head, entry.head, base]) {
		for (const path of git(root, [
			"ls-tree",
			"-rz",
			"--name-only",
			ref,
			"--",
			"flake.nix",
			"flake.lock",
			"nix",
			".envrc",
			".github",
		])
			.split("\0")
			.filter(Boolean))
			paths.add(path);
	}
	for (const path of paths) {
		const tree = (ref: string) => git(root, ["--literal-pathspecs", "ls-tree", ref, "--", path]);
		if (tree(head) !== tree(entry.head) && tree(head) !== tree(base))
			throw new Error(`off-limits fixer edit: ${path}`);
	}
}

function review(body: string, head: string, reason: string): string {
	body = body.replace(/\s*\(written by GPT-6.1 Sol\)\s*$/, "");
	const line = `mechanical fix by Codex: ${reason} (head ${head})`;
	if (body.includes(line)) return body;
	const section = /^## Review\s*$/m.exec(body);
	if (!section) return `${body.trimEnd()}\n\n## Review\n\n${line}\n`;
	const start = section.index + section[0].length;
	return `${body.slice(0, start)}\n\n${line}${body.slice(start)}`;
}

export async function collectFixers(
	root: string,
	state: string,
	deps: GitHubDependencies,
	token: (workflows: boolean) => Promise<string>,
	timeout = 60,
): Promise<string[]> {
	const github = new GitHub(deps);
	const output: string[] = [];
	for (const name of readdirSync(state).filter((name) => /^fix-job-.*\.json$/.test(name))) {
		const path = join(state, name);
		const job = JSON.parse(readFileSync(path, "utf8")) as Job;
		if (!job.results && !job.error) {
			if (deps.now() - job.started > timeout * 60_000) {
				if (job.pid && job.identity && identity(job.pid) === job.identity) {
					try {
						process.kill(-job.pid, "SIGKILL");
					} catch {}
				}
				job.error = "fixer timed out; run /quest-iterate to diagnose and retry";
			} else if (existsSync(`${path}.exit`)) {
				const code = readFileSync(`${path}.exit`, "utf8");
				if (code !== "0") job.error = `fixer crashed (exit ${code}); run /quest-iterate`;
				else
					try {
						job.results = parseFixResult(readFixResult(job.checkout), job.numbers);
					} catch (error) {
						job.error = `invalid fixer result: ${String(error)}; run /quest-iterate`;
					}
			} else if (job.pid && job.identity && identity(job.pid) === job.identity) continue;
			else job.error = "fixer disappeared before recording an exit status; run /quest-iterate";
			save(path, job);
		}
		while (job.numbers.length) {
			const number = job.numbers[0];
			const entry = job.plan.queue.find((entry) => entry.number === number)!;
			const result = job.results?.find((item) => item.number === number);
			let error = job.error ?? job.handbacks?.[number];
			const pullPath = `/repos/${job.plan.repository}/pulls/${number}`;
			const pull = object(await (await github.request(pullPath)).json());
			const current = string(object(pull.head).sha);
			const queued = await github.graphql(
				"query($id: ID!) { node(id: $id) { ... on PullRequest { state autoMergeRequest { enabledAt } } } }",
				{ id: entry.id },
			);
			const auto = object(queued.node).autoMergeRequest;
			const previous = attempt(state, number)!;
			const head = result?.action === "fixed" ? result.head : entry.head;
			if (previous.pick !== entry.enabledAt)
				error = "fixer was superseded by a newer maintainer pick; keeping its work untouched";
			// Never displace a newer maintainer pick, closed PR, or writer's commit.
			if (
				pull.state !== "open" ||
				(current !== entry.head && !(job.published.includes(number) && current === head))
			)
				error = "PR closed or head moved while fixing; inspect and pick it again";
			if (auto != null) {
				if (
					job.published.includes(number) &&
					current === head &&
					previous.head === head &&
					(!previous.requeued || previous.requeued === object(auto).enabledAt)
				) {
					save(attemptPath(state, number), { ...previous, requeued: string(object(auto).enabledAt) });
				} else error = "PR was picked again while fixing; keeping the newer pick";
			} else if (!error && result?.action !== "handback") {
				try {
					if (result?.action === "fixed") {
						if (entry.repository !== job.plan.repository && !entry.maintainerCanModify)
							throw new FixerRefusal("fork does not allow maintainer edits");
						// Fetch into the private repository before inspecting anything: no fixer config or hooks run here.
						git(root, ["fetch", "--quiet", "--no-tags", job.checkout, `refs/heads/pr-${number}`]);
						if (git(root, ["rev-parse", "FETCH_HEAD"]) !== head)
							throw new FixerRefusal("result head differs from PR branch");
						git(root, ["fetch", "--quiet", "--no-tags", baseRemote(job.plan), job.plan.base.ref]);
						try {
							validateFix(root, entry, head, git(root, ["rev-parse", "FETCH_HEAD"]));
						} catch (error) {
							throw new FixerRefusal(String(error));
						}
					}
					if (!job.published.includes(number)) {
						job.published.push(number);
						save(path, job);
					}
					if (result?.action === "fixed" && current !== head) {
						const pushed = await push(
							root,
							`https://github.com/${entry.repository}.git`,
							entry.head,
							head,
							`refs/heads/${entry.branch}`,
							token,
						);
						if (pushed.status !== 0) throw new FixerRefusal(`fixer push refused: ${pushed.stderr.trim()}`);
					}
					if (result?.action === "fixed")
						await github.request(pullPath, {
							method: "PATCH",
							body: {
								body:
									review(typeof pull.body === "string" ? pull.body : "", head, result.reason) +
									"\n(written by GPT-6.1 Sol)",
							},
						});
					// Save intent before enabling, so a lost response can be reconciled after restart.
					save(attemptPath(state, number), { ...previous, head });
					await github.graphql(
						"mutation($id: ID!, $sha: GitObjectID!, $body: String!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, expectedHeadOid: $sha, mergeMethod: SQUASH, commitBody: $body }) { clientMutationId } }",
						{ id: entry.id, sha: head, body: pin(head) },
					);
					const enabled = await github.graphql(
						"query($id: ID!) { node(id: $id) { ... on PullRequest { autoMergeRequest { enabledAt } } } }",
						{ id: entry.id },
					);
					const enabledAt = string(object(object(enabled.node).autoMergeRequest).enabledAt);
					save(attemptPath(state, number), { ...previous, head, requeued: enabledAt });
				} catch (failure) {
					if (!(failure instanceof FixerRefusal)) throw failure;
					error = `${String(failure)}; run /quest-iterate before picking it again`;
				}
			}
			if (!error && result?.action !== "handback") {
				await github.request(`/repos/${job.plan.repository}/issues/${number}/labels`, {
					body: { labels: [MERGE_LABEL] },
				});
				if (result?.action === "requeue")
					await comment(
						github,
						job.plan,
						entry,
						`Requeued unchanged: ${result.reason}. Suggested follow-up: investigate the batch failure and stabilize any flaky checks.`,
						"requeue",
					);
			}

			if (error) {
				job.handbacks ??= {};
				job.handbacks[number] = error;
				save(path, job);
			}

			if (error || result?.action === "handback")
				await comment(
					github,
					job.plan,
					entry,
					error ??
						(result?.action === "handback"
							? `${result.diagnosis}. Recommendation: ${result.recommendation}`
							: "missing result"),
					"handback",
				);
			output.push(`${error || result?.action === "handback" ? "handback" : "requeued"} ${number}`);
			job.numbers.shift();
			save(path, job);
		}
		rmSync(job.checkout, { recursive: true, force: true });
		rmSync(`${path}.exit`, { force: true });
		rmSync(path);
	}
	return output;
}
