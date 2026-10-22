// The `quest` command line: argument parsing and output around the core.

import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { description, version } from "../../package.json";
import {
	type Doc,
	type RankedQuest,
	blockers,
	check,
	formatFinding,
	label,
	lookup,
	questBranch,
	renderBlocker,
	unblocked,
} from "../core";
import { AgentInputError, HARNESSES, type Launch, processDependencies, runAgent, stopAgent, stopAll } from "./agent";
import {
	DEFAULT_URL,
	RunnerInputError,
	addAccount,
	listAccounts,
	login,
	removeAccount,
	runRunner,
} from "../runner/cli";
import { held, reach, target, upstream, upstreamHead } from "./claims";
import { gate } from "./gate";
import { gitHubDependencies, GitHubInputError, mergedHead, pullRequest, remoteUrl } from "./github";
import { landed } from "./landed";
import { type Report, moveQuest, removeQuest } from "./move";
import { init, uninstall } from "./setup";
import { Refusal, describe, notUpstream, releaseQuest, startQuest } from "./start";
import { GUIDE, SKILLS, skill } from "./skills";
import { type Terminal, Theme } from "./theme";
import { type Snapshot, checkout, collect, exists, load, snapshot, under } from "./tree";
import { pullRequestStatus, statusLines } from "./status";
import { waitForActivity, WaitTimeout } from "./wait";
import { Worktrees } from "./worktree";

/** Where the command writes; the process streams, or a buffer under test. */
export interface Output {
	stdout(text: string): void;
	stderr(text: string): void;
	/** Set when stdout is a terminal, which gets themed output. Piped output is plain. */
	terminal?: Terminal;
}

/** A failure the user caused rather than the command, reported as a usage error. */
class UsageError extends Error {}

/** Run the CLI with `argv` (arguments only, no executable). Returns the exit code. */
export function main(argv: string[], out: Output): number | Promise<number> {
	let pending: Promise<number> | undefined;
	let code = 0;
	const print = (line: string) => out.stdout(`${line}\n`);
	const warn = (line: string) => out.stderr(`quest: ${line}\n`);
	const theme = out.terminal ? new Theme(out.terminal) : null;

	const program = new Command("quest")
		.description(description)
		.version(`quest ${version}`, "-V, --version", "Print version")
		.helpOption("-h, --help", "Print help")
		.helpCommand("help [command]", "Print this message or the help of the given subcommand")
		.addOption(
			new Option("--root <root>", "Repository root holding the quest/ directory")
				.default(".")
				.argParser(nonEmpty),
		)
		.configureOutput({ writeOut: out.stdout, writeErr: out.stderr })
		.configureHelp({ showGlobalOptions: true })
		.addHelpText(
			"after",
			"\nOn a terminal, output is themed as a quest log; set NO_COLOR to drop the colours.\n" +
				"Piped output is plain text for scripts and agents.",
		)
		.exitOverride();
	const root = () => program.opts<{ root: string }>().root;

	program
		.command("gate")
		.summary("Run an expensive command once the host has room for it")
		.description(
			"Wait while the 1-minute load average exceeds the host's CPU count or available memory is below " +
				"min(4 GiB, RAM/4). Each admission in the last minute counts as one more unit of load and one " +
				"budget less memory: commands start at once while those still fit, and 5 seconds apart while " +
				"only the raw measures do. Nested calls run immediately. Limits come from the host; there is " +
				"no configuration.",
		)
		.argument("<command>", "Executable to run")
		.argument("[args...]", "Arguments forwarded verbatim")
		.action((command: string, args: string[]) => {
			pending = gate([command, ...args]).catch((error: unknown) => {
				warn(error instanceof Error ? error.message : String(error));
				return 1;
			});
		});

	program
		.command("check")
		.summary("Report every structural mistake in the tree; exit non-zero if any")
		.description(
			"Report every structural mistake in the tree; exit non-zero if any.\n\n" +
				"With --base, also check that a PR from a quest's branch leaves that quest accurate. When the branch " +
				"is a quest's path without .md (an epic's is quest/<path>/README) and that quest exists at the merge " +
				"base with <ref>, the working tree must delete or edit it; a PR that finishes the quest deletes it, and " +
				"one that leaves work rewrites it to what remains. Any other branch adds no finding. Fetch <ref> " +
				"first: a stale base can predate the quest and skip it.",
		)
		.option("--base <ref>", "Also check the quest branch's diff from its merge base with this ref")
		.option("--branch <name>", "The PR's head branch, when it differs from the current branch (needs --base)")
		.action((options: { base?: string; branch?: string }) => {
			if (options.branch !== undefined && options.base === undefined) {
				throw new UsageError("--branch requires --base");
			}
			const findings = check(load(root()), (path) => exists(root(), path));
			if (options.base !== undefined) findings.push(...landed(root(), options.base, options.branch));
			if (findings.length === 0) {
				const count = collect(root()).length;
				print(theme ? theme.checked(count) : `quest: ${count} documents ok`);
				return;
			}
			for (const finding of findings) warn(formatFinding(finding));
			code = 1;
		});

	/** The quest document `path` names, as the tree writes it, as the shell completes it, or as a filesystem path. */
	const locate = (docs: Doc[], path: string): Doc | null => {
		const inside = withinRoot(root(), path);
		return lookup(docs, path) ?? (inside === null ? null : lookup(docs, inside));
	};

	/** Like `locate`, failing when `path` names no quest. */
	const find = (docs: Doc[], path: string): Doc => {
		const doc = locate(docs, path);
		if (doc === null) throw new Error(`${path} is not a quest document under ${under(root(), "quest")}`);
		return doc;
	};

	/** Whether the tree passes `quest check`; otherwise report its findings and fail. */
	const valid = ({ docs, exists }: Snapshot): boolean => {
		const findings = check(docs, exists);
		for (const finding of findings) warn(formatFinding(finding));
		if (findings.length > 0) code = 1;
		return findings.length === 0;
	};

	/** Print what blocks `doc`: the themed log on a terminal, else the blocker list with advice on stderr. */
	const explain = (docs: Doc[], doc: Doc, path: string) => {
		const found = blockers(docs, doc);
		if (theme) {
			// The themed log already names every blocker; stderr keeps only the advice.
			for (const line of theme.blockers(new Map(docs.map((d) => [d.path, d])), doc, found)) print(line);
		} else {
			for (const blocker of found) {
				for (const line of renderBlocker(blocker)) print(line);
				warn(`blocked by ${label(blocker)}`);
			}
		}
		if (found.length > 0) {
			// Blocked is not a verdict on the whole plan: the piece of it that
			// does not need the blocker is split into its own quest.
			warn(
				`${path} is blocked; split any independently landable piece into its own quest (\`quest guide\`, Creation) rather than starting this one as it stands`,
			);
		}
	};

	/** A claim command's outcome: 0 when done, 3 when refused, and 1 for any other failure. */
	const settle = <T>(work: Promise<T>, done: (result: T) => number | void) => {
		pending = work.then(
			(result) => done(result) ?? 0,
			(error: unknown) => {
				warn(error instanceof Error ? error.message : String(error));
				return error instanceof Refusal ? 3 : 1;
			},
		);
	};

	program
		.command("unblocked")
		.summary("Rank ready quests, or print what blocks one quest")
		.description(
			"Rank ready quests by milestone priority, distinct transitive dependents, then tree order. " +
				"Given a path, print what blocks that quest instead.\n\n" +
				"Counts exclude structural epic membership. Other prerequisites may remain for dependents. " +
				"Invalid trees fail before printing a ranking. Prints a count and path per line; --json prints an " +
				"ordered array of {path, dependents} objects.\n\n" +
				"--unclaimed ranks the fetched upstream default branch's tree instead of the checkout, then drops " +
				"quests someone holds: a quest branch upstream, or an open PR from that branch in any repository. A " +
				"branch whose tip is a merged PR's head holds nothing; a closed, unmerged PR's branch still does. A " +
				"GitHub fork's upstream is its parent, and the branches and PRs of the fork the remote pushes to " +
				"count too. Each skipped quest is listed on stderr with its PR and how long ago that PR was last " +
				"active, so a stale claim can be offered for takeover. Off GitHub, only branches are checked. " +
				"Outside conditions are never checked.\n\n" +
				"Given a path, piped output lists its blockers, one per line with nesting indented, with an " +
				"explanation on stderr; no output means it is ready. On a terminal it prints a quest log instead: a " +
				"yellow ! for a ready quest, a grey ! for a blocked one, and each size label in its colour. Set " +
				"NO_COLOR to drop the colours. Exits 0 whether or not the quest is blocked; non-zero means the " +
				"command failed.",
		)
		.argument("[path]", "Quest to explain instead of ranking every ready quest")
		.option("--json", "Print a deterministic JSON array")
		.option("--limit <count>", "Maximum number of ready quests to print", positiveInteger("limit"))
		.option("--unclaimed", "Skip quests with a claim branch or open PR, listing them on stderr")
		.option("--remote <name>", "Remote whose upstream holds the claims", "origin")
		.action(
			(
				path: string | undefined,
				options: { json?: boolean; limit?: number; unclaimed?: boolean; remote: string },
			) => {
				if (path !== undefined) {
					if (options.json || options.limit !== undefined || options.unclaimed) {
						throw new UsageError("--json, --limit, and --unclaimed apply to the ranking; omit the path");
					}
					const docs = load(root());
					explain(docs, find(docs, path), path);
					return;
				}
				const show = (quests: RankedQuest[]) => {
					const shown = quests.slice(0, options.limit);
					if (options.json) {
						print(JSON.stringify(shown));
						return;
					}
					if (theme)
						print("Ready quests by milestone and downstream impact (other prerequisites may remain):");
					for (const quest of shown) print(`${quest.dependents}\t${quest.path}`);
				};
				if (!options.unclaimed) {
					const tree = checkout(root());
					if (valid(tree)) show(unblocked(tree.docs));
					return;
				}
				// Readiness comes from the upstream default branch, so a stale checkout cannot offer
				// a deleted quest or one whose prerequisite has since finished.
				const deps = { github: () => gitHubDependencies(warn), warn };
				settle(
					(async () => {
						const up = await reach(root(), options.remote, deps);
						const tree = up === null ? checkout(root()) : snapshot(root(), upstreamHead(root(), up.git));
						if (!valid(tree)) return null;
						const ranked = unblocked(tree.docs);
						const branches = ranked.map((quest) => questBranch(quest.path));
						return { ranked, holdings: up === null ? [] : (await held(root(), up, branches)).claims };
					})(),
					(result) => {
						if (result === null) return 1;
						const byBranch = new Map(result.holdings.map((claim) => [claim.branch, claim]));
						const now = Date.now();
						for (const quest of result.ranked) {
							const claim = byBranch.get(questBranch(quest.path));
							if (claim)
								warn(`skipped ${quest.path}: held by ${describe(claim.branch, claim.pull, now)}`);
						}
						show(result.ranked.filter((quest) => !byBranch.has(questBranch(quest.path))));
					},
				);
			},
		);

	program
		.command("start")
		.summary("Claim a ready quest with a draft PR, or release that claim")
		.description(
			"Claim a ready quest: push an empty claim commit, built on the upstream default branch, to the quest's " +
				"branch (its path without .md), then open a draft PR from it right away. Switches the " +
				"checkout to the claim on a new local branch, or fast-forwards that branch when it is checked out, " +
				"and prints the PR URL, or the branch off GitHub.\n\n" +
				"Readiness comes from the fetched upstream default branch's tree, not the checkout. Fails on a tree " +
				"quest check rejects, which can hide a blocker. Refuses a blocked quest, one missing from the " +
				"upstream default branch, and one already held: a branch upstream or an open PR from that branch in " +
				"any repository. A branch whose tip is a merged PR's head holds nothing, and the claim replaces it " +
				"with a lease on that tip. A rejected push means someone else pushed the branch first. When two PRs " +
				"race, as from forks, the earliest open PR keeps the claim; a later one is closed and its branch " +
				"deleted.\n\n" +
				"The remote's upstream holds claims: a GitHub fork pushes the branch to itself and opens the PR on its " +
				"parent, and so does a remote that fetches from upstream but pushes to a fork. Off GitHub, only the " +
				"branch is pushed, with a warning.\n\n" +
				"--release deletes the quest's branch on the remote, with a lease on its tip, and closes its PR, only " +
				"while that tip is still an empty commit.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token on GitHub. Exits 0 when done, 3 when refused " +
				"(blocked, held, or work on the branch), 2 for invalid arguments, and 1 for other failures.",
		)
		.argument("<quest>", "Quest to claim, as /quest/..., quest/..., or a filesystem path")
		.option("--release", "Release the claim instead: delete the empty claim branch and close its PR")
		.option("--remote <name>", "Remote to push the claim to", "origin")
		.action((path: string, options: { release?: boolean; remote: string }) => {
			const deps = { github: () => gitHubDependencies(warn), warn };
			if (options.release) {
				settle(releaseQuest(root(), find(load(root()), path).path, options.remote, deps), (released) => {
					print(`deleted ${released.branch}`);
					for (const url of released.closed) print(`closed ${url}`);
				});
				return;
			}
			settle(
				(async () => {
					// Readiness comes from the upstream default branch the claim builds on, not the checkout.
					const at = await target(root(), options.remote, deps);
					const doc = locate(at.tree.docs, path);
					if (doc === null) throw notUpstream(find(load(root()), path).path);
					// A malformed tree can hide a blocker, as a misspelled `## Required` does.
					if (!valid(at.tree)) return 1;
					if (blockers(at.tree.docs, doc).length > 0) {
						explain(at.tree.docs, doc, path);
						return 3;
					}
					return startQuest(root(), at, doc.path, doc.title?.text ?? doc.path, deps);
				})(),
				(started) => {
					if (typeof started === "number") return started;
					print(started.url ?? started.branch);
				},
			);
		});

	program
		.command("wait")
		.summary("Wait for pull request activity on GitHub")
		.description(
			"Wait for a review, comment, review-thread reply, reaction to the PR or a review, push, merge, close, " +
				"merge-queue removal, disabled auto-merge, or required CI result. Polls every 5 minutes, and once more 30 seconds before the timeout; rate limits and longer GitHub poll intervals delay requests. No timeout by default.\n\n" +
				"Prints one plain line per event: timestamp (or commit SHA), type, actor, URL; the last line adds a resume cursor. " +
				"Reactions print as reacted:<content>, such as reacted:thumbs_up. " +
				"The head's first failing required check prints as checks:failed, and every required check passing as checks:passed, " +
				"each once per head, with the check's name as the actor and its details URL. " +
				"Results count as quest status counts them, so neutral and skipped results pass. " +
				"checks:passed waits until no check is pending, no GitHub Actions run is unfinished, and every check and workflow the base branch names is present, then names the last check to finish. " +
				"Optional checks never wake the wait, unless the base branch requires none, which requires them all. " +
				"Pass the final field of the last line to --since to resume without replaying events. " +
				"On timeout, the only line is a resume point for --since (a cursor, or the given --since or head SHA if setup did not finish), so a retry with it still reports activity from the first wait.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token. Replies and reactions by that account are ignored. " +
				"Exits 0 for activity, 3 on timeout, 2 for invalid arguments, and 1 for other failures. " +
				"Edits are not activity.",
		)
		.argument("<pr>", "GitHub PR URL, or a PR number in origin")
		.option("--since <point>", "ISO timestamp, pushed-tip SHA, or resume cursor (default: current head push time)")
		.option("--timeout <seconds>", "Maximum wait in seconds", positiveSeconds)
		.action((value: string, options: { since?: string; timeout?: number }) => {
			const pr = pullRequest(value, root());
			pending = waitForActivity(pr, options, gitHubDependencies(warn)).then(
				(lines) => {
					for (const line of lines) print(line);
					return 0;
				},
				(error: unknown) => {
					if (error instanceof WaitTimeout && error.cursor) print(error.cursor);
					warn(error instanceof Error ? error.message : String(error));
					return error instanceof WaitTimeout ? 3 : error instanceof GitHubInputError ? 2 : 1;
				},
			);
		});

	program
		.command("status")
		.summary("Print a pull request's current state on GitHub")
		.description(
			"Print a pull request's head, checks, merge state, reviews, reactions, and unresolved review threads " +
				"in one call. It reports facts; it does not decide whether the PR is ready or whose review counts.\n\n" +
				"Plain output prints one record per line, its type first and any free text (a check name or path) last: " +
				"url, state, draft, head, mergeable, merge-state, review-decision, auto-merge, merge-queue, and checks; " +
				"then a check line per failing or pending check, marked required or optional; a review line per " +
				"reviewer's latest review, marked current or stale against the head; a reacted:<content> line per " +
				"reaction on the PR or a review; and a thread line per unresolved review thread, led by its node ID. " +
				"A missing value prints as -. --json prints the same facts as one deterministic object.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token. Exits 0 for any PR state, 2 for invalid arguments, " +
				"and 1 for other failures.",
		)
		.argument("<pr>", "GitHub PR URL, or a PR number in origin")
		.option("--json", "Print a deterministic JSON object")
		.action((value: string, options: { json?: boolean }) => {
			const pr = pullRequest(value, root());
			pending = pullRequestStatus(pr, gitHubDependencies(warn)).then(
				(status) => {
					if (options.json) print(JSON.stringify(status));
					else for (const line of statusLines(status)) print(line);
					return 0;
				},
				(error: unknown) => {
					warn(error instanceof Error ? error.message : String(error));
					return 1;
				},
			);
		});

	const worktree = program
		.command("worktree")
		.description(
			"Reserve disk for Git checkouts, release it by pruning their scratch in place, and remove finished ones",
		);
	const state = () => new Worktrees();
	const record = (value: unknown) => print(JSON.stringify(value));
	worktree
		.command("capacity <bytes>")
		.description("Set this user's shared disk budget in bytes")
		.action((bytes: string) => {
			state().configure(positiveInteger("bytes")(bytes));
		});
	worktree
		.command("status")
		.description("Print the capacity, allocated bytes, and checkouts as JSON")
		.action(() => record(state().status()));
	worktree
		.command("create <name>")
		.description("Create an exclusively owned detached Git worktree under .worktrees/")
		.requiredOption("--reserve <bytes>", "Checkout and expected build growth in bytes", positiveInteger("bytes"))
		.option("--ref <ref>", "Initial Git revision", "HEAD")
		.option(
			"--scratch <path...>",
			"Ignored paths release deletes, such as dependencies and build output; they must hold no tracked files",
			[],
		)
		.action((name: string, options: { reserve: number; ref: string; scratch: string[] }) =>
			record(state().create(root(), name, options.reserve, options.ref, options.scratch)),
		);
	worktree
		.command("run")
		.summary("Run a command in a checkout, then release it once every process stops")
		.description(
			"Run a command in the checkout, restoring it first when released. The command and its descendants " +
				"run in a new systemd user scope; once the command exits, descendants still in the scope are killed. " +
				"When no other supervised run remains, the scratch declared at creation is pruned. Put the whole job, " +
				"such as an agent session or a script that installs, builds, and tests, in one run.\n\n" +
				"A supervisor that crashes leaves its run recorded; the next worktree command drops it once its scope " +
				"is empty, and releases the checkout; `quest worktree stop` ends what it left. Needs Linux 5.14+ with a systemd 254+ user manager and unified cgroup " +
				"v2, and fails on other hosts. Exits with the command's status; a release that fails is reported, leaves " +
				"the checkout reserved, and turns success into exit 1.",
		)
		.argument("<id>", "Checkout ID or name")
		.argument("<command>", "Executable to run; put -- before it when any argument starts with -")
		.argument("[args...]", "Arguments forwarded verbatim")
		.action((id: string, command: string, args: string[]) => {
			pending = state()
				.run(id, [command, ...args])
				.then(
					({ code, failure }) => {
						if (!failure) return code;
						warn(failure);
						return code || 1;
					},
					(error: unknown) => {
						warn(error instanceof Error ? error.message : String(error));
						return 1;
					},
				);
		});
	worktree
		.command("release <id>")
		.description(
			"Delete the scratch declared at creation and keep the checkout; refuses while supervised runs are live, " +
				"and drops the record of a removed checkout",
		)
		.action((id: string) => record(state().release(id)));
	const settled = (result: Promise<unknown>) => {
		pending = result.then(
			(value) => {
				record(value);
				return 0;
			},
			(error: unknown) => {
				warn(error instanceof Error ? error.message : String(error));
				return 1;
			},
		);
	};
	// Only a commit no local ref reaches asks the forge, so other removals need no token.
	const merged = async (repository: string, commit: string) => {
		try {
			remoteUrl(repository, "origin");
		} catch {
			return false; // No forge to ask.
		}
		const up = await upstream(repository, "origin", { github: () => gitHubDependencies(warn), warn });
		return up.github !== null && mergedHead(up.github.client, up.github.repository, commit);
	};
	worktree
		.command("remove <id>")
		.description(
			"Delete a finished checkout and drop its record, never forcing. Refuses while supervised runs are live, " +
				"and refuses modified, untracked, or ignored files beyond the declared scratch, and commits no branch " +
				"or remote-tracking ref reaches, unless origin's GitHub repository merged a PR whose head is exactly " +
				"that commit. Prunes the scratch first, so a refusal over ignored files leaves the checkout released.",
		)
		.action((id: string) => settled(state().remove(id, merged)));
	worktree
		.command("stop <id>")
		.description(
			"Kill the processes crashed supervisors left in the checkout's scopes and wait until they are gone, then " +
				"release the checkout once no run remains. Runs whose supervisor is alive are left to it and reported " +
				"as a failure.",
		)
		.action((id: string) => settled(state().stop(id)));
	worktree
		.command("restore <id>")
		.description("Reserve a released checkout's disk again before rebuilding its scratch")
		.action((id: string) => record(state().restore(id)));

	const agent = program
		.command("agent")
		// Options come before <worktree>, so a prompt or answer starting with "-" is never read as one.
		.enablePositionalOptions()
		.summary("Start, resume, and stop headless agents billed to API keys")
		.description(
			"Run one headless agent turn per call in the foreground, billed to one of the keys in QUEST_API_KEYS, " +
				"so a spawn launches every agent with one legible command.\n\n" +
				"QUEST_API_KEYS lists keys separated by whitespace; --key names one by its 1-based position. An " +
				"entry may be a 1Password op:// reference: the first launch resolves every reference in one " +
				"`op inject` and keeps the keys in a user-only store under $XDG_RUNTIME_DIR (or the temporary " +
				"directory) shared by the repository's worktrees, until `quest agent stop --all`.\n\n" +
				"The agent runs in <worktree> with the user's environment minus every CLAUDE* (except CLAUDE_CONFIG_DIR), " +
				"ANTHROPIC*, CODEX_* (except CODEX_HOME), OP_*, OPENAI_API_KEY, QUEST_API_KEYS, and QUEST_GATE_ADMITTED variable, plus " +
				"its one key as " +
				"ANTHROPIC_API_KEY (claude -p) or CODEX_API_KEY (codex exec). It never prints a key; any the agent " +
				"repeats is shown as <key N>.\n\n" +
				"Prints `session <id>` as soon as the id is known, then `cost <dollars>` when the agent reports it, " +
				"`outcome finished|failed|exhausted|stopped`, a blank line, and the agent's final reply. Exits 0 " +
				"when the agent finished, 3 when the provider refused the key for lack of credit, 2 for invalid " +
				"arguments, 128 plus the signal number when interrupted, and 1 otherwise.",
		);
	const launchOptions = (command: Command) =>
		command
			.addOption(new Option("--harness <name>", "Agent CLI to run").choices(HARNESSES).makeOptionMandatory())
			.requiredOption("--key <position>", "1-based position of the key in QUEST_API_KEYS", positiveInteger("key"))
			.requiredOption("--model <model>", "Model the agent runs")
			.requiredOption("--effort <level>", "Reasoning effort the agent runs at")
			.requiredOption(
				"--permission-mode <mode>",
				"Claude Code's --permission-mode, or Codex's sandbox mode; the agent cannot prompt",
			);
	type LaunchOptions = Omit<Launch, "worktree">;
	const launch = (worktree: string, prompt: string, session: string | undefined, options: LaunchOptions) => {
		pending = runAgent({ ...options, worktree }, prompt, session, agentDependencies()).catch(agentFailure);
	};
	const agentDependencies = () => processDependencies({ stdout: out.stdout, stderr: out.stderr });
	const agentFailure = (error: unknown) => {
		if (error instanceof AgentInputError) {
			out.stderr(`error: ${error.message}\n`);
			return 2;
		}
		warn(error instanceof Error ? error.message : String(error));
		return 1;
	};
	launchOptions(
		agent
			.command("start")
			.description("Start a new agent session in a worktree with a prompt")
			.argument("<worktree>", "Checkout the agent works in")
			.argument("<prompt>", "The agent's instructions")
			.passThroughOptions(),
	).action((worktree: string, prompt: string, options: LaunchOptions) =>
		launch(worktree, prompt, undefined, options),
	);
	launchOptions(
		agent
			.command("resume")
			.description("Resume an agent's session in its worktree with a message")
			.argument("<worktree>", "Checkout the session ran in")
			.argument("<session>", "Session id printed by start")
			.argument("<message>", "The next message, such as an answer to its decisions")
			.passThroughOptions(),
	).action((worktree: string, session: string, message: string, options: LaunchOptions) =>
		launch(worktree, message, session, options),
	);
	agent
		.command("stop")
		.summary("Stop the agent in a worktree, or end the spawn with --all")
		.description(
			"Stop the agent running in a worktree and wait until its start or resume has reported. With --all, " +
				"end the spawn: stop every agent in this repository's worktrees and delete the resolved keys.",
		)
		.argument("[worktree]", "Checkout whose agent to stop")
		.option("--all", "Stop every agent and delete the resolved keys")
		.action((worktree: string | undefined, options: { all?: boolean }) => {
			if ((worktree === undefined) === !options.all) throw new UsageError("give a worktree or --all");
			const deps = agentDependencies();
			pending = (worktree === undefined ? stopAll(root(), deps) : stopAgent(worktree, deps)).then(
				() => 0,
				agentFailure,
			);
		});

	const runnerIO = () => ({ stdout: out.stdout, stderr: out.stderr, env: process.env });
	const runnerFailure = (error: unknown) => {
		if (error instanceof RunnerInputError) {
			out.stderr(`error: ${error.message}\n`);
			return 2;
		}
		warn(error instanceof Error ? error.message : String(error));
		return 1;
	};
	const runnerAction = (task: () => number | Promise<number>) => {
		try {
			pending = Promise.resolve(task()).catch(runnerFailure);
		} catch (error) {
			pending = Promise.resolve(runnerFailure(error));
		}
	};
	const runner = program
		.command("runner")
		.summary("Run kix jobs on this machine with its own agent accounts")
		.description(
			"Turn this Linux or macOS machine into a kix runner. `quest runner login` connects it to your kix " +
				"account, `quest runner account add` signs agent accounts in with their own CLIs, and `quest runner` " +
				"runs routed jobs in the foreground until interrupted.\n\n" +
				"Each account signs in through Claude Code's own flow in an isolated home (CLAUDE_CONFIG_DIR); kix " +
				"stores only an opaque account id, its kind, and its label, and never sees its tokens. Every job runs " +
				"inside its project's `nix develop` shell. State lives in $QUEST_RUNNER_HOME, by default " +
				"$XDG_DATA_HOME/quest/runner.",
		);
	runner
		.command("run", { isDefault: true })
		.description(
			"Connect to kix and run assigned jobs until interrupted. On SIGINT or SIGTERM, running agents stop, " +
				"their work is published to their job branches, and their jobs move to another runner.",
		)
		.option("--slots <count>", "Jobs to run at once", positiveInteger("slots"), 1)
		.action((options: { slots: number }) => runnerAction(() => runRunner(runnerIO(), options)));
	runner
		.command("login")
		.description(
			"Connect this machine to your kix account: print a link to approve it while signed in, then wait. " +
				"The machine keeps its token; the link carries only its hash.",
		)
		.option("--url <origin>", "The kix origin", DEFAULT_URL)
		.option("--name <name>", "The name kix shows for this machine (default: its hostname)")
		.action((options: { url: string; name?: string }) => runnerAction(() => login(runnerIO(), options)));
	const account = runner.command("account").description("Add, list, and remove this runner's agent accounts");
	account
		.command("add")
		.description("Sign a Claude Code account in with `claude auth login` in a new isolated home")
		.option("--console", "Sign in with an Anthropic Console account (API billing) instead of a subscription")
		.option("--label <label>", "The name kix shows for the account (default: its email and plan)")
		.action((options: { console?: boolean; label?: string }) =>
			runnerAction(() => addAccount(runnerIO(), { console: !!options.console, label: options.label })),
		);
	account
		.command("list")
		.description("Print each account's id, kind, and label")
		.action(() => runnerAction(() => listAccounts(runnerIO())));
	account
		.command("remove <id>")
		.description("Remove an account and delete its home, signing it out of this machine")
		.action((id: string) => runnerAction(() => removeAccount(runnerIO(), id)));

	/** Changes on stdout; mentions and check findings on stderr, which fail the command. */
	const report = (result: Report): number => {
		for (const line of result.changes) print(line);
		for (const line of result.warnings) warn(line);
		for (const line of result.findings) warn(line);
		return result.findings.length > 0 ? 1 : 0;
	};

	program
		.command("mv")
		.summary("Move a quest or epic and rewrite the links to it")
		.description(
			"Move a quest, or an epic directory and everything under it, with git mv, and rewrite every " +
				"root-absolute link to it under quest/. The change is staged.\n\n" +
				"Refuses the root epic and milestones, which are permanent. Refuses outside a git work tree, when " +
				"the destination exists, and while a moved quest has a claim branch or open PR on origin, or on " +
				"the repository a GitHub fork came from, since the old branch would no longer name it. Moving a " +
				"quest into or out of an epic changes which epic lists it; the check afterwards reports what to fix.\n\n" +
				"Prints R for the move and M for each edited document. Mentions of the old path that are not links, " +
				"or are outside quest/, are reported on stderr and left alone. Runs quest check on the result and " +
				"exits 1 if it fails.",
		)
		.argument("<from>", "Quest file or epic directory, as /quest/..., quest/..., or a filesystem path")
		.argument("<to>", "Its new path, which must not exist")
		.action((from: string, to: string) => {
			pending = moveQuest(root(), from, to, { github: () => gitHubDependencies(warn), warn }).then(
				report,
				(error: unknown) => {
					warn(error instanceof Error ? error.message : String(error));
					return 1;
				},
			);
		});

	program
		.command("rm")
		.summary("Delete a quest or epic and drop the links to it")
		.description(
			"Delete a quest, or an epic and the quests under it, with git rm, and drop every Required, Related, " +
				"or Closes entry that links to it, with any heading left empty. It also drops every Required link to a " +
				"finished milestone, one whose README has no Required left, except the root's own listing. The change " +
				"is staged.\n\n" +
				"Refuses outside a git work tree. An epic is its directory or README; removing one that holds other " +
				"quests requires -r. The root epic and milestones are permanent.\n\n" +
				"Prints D for each deleted quest and M for each edited document. Mentions that are not list entries, " +
				"or are outside quest/, are reported on stderr and left alone. Runs quest check on the result and " +
				"exits 1 if it fails.",
		)
		.argument("<path>", "Quest file, or epic directory or README")
		.option("-r, --recursive", "Remove an epic with the quests under it")
		.action((path: string, options: { recursive?: boolean }) => {
			code = report(removeQuest(root(), path, options.recursive ?? false));
		});

	program
		.command("guide")
		.description("Print the quest guide: the format, workflow, and rules agents follow")
		.action(() => out.stdout(GUIDE));

	program
		.command("skill")
		.summary("Print a skill's instructions, or list the skills with no name")
		.description(
			"Print a skill's instructions, or list the skills with no name.\n\n" +
				"A repository installs only a stub per skill, which runs this, so the pinned binary decides what " +
				"every agent follows.",
		)
		.argument("[name]", "Skill to print")
		.option("--stub", "Print the stub SKILL.md a repository installs instead")
		.action((name: string | undefined, options: { stub?: boolean }) => {
			if (name === undefined) {
				if (options.stub) throw new UsageError("--stub requires a skill name");
				for (const s of SKILLS) print(`${s.name} - ${s.description}`);
				return;
			}
			const found = skill(name);
			if (!found) throw new Error(`no skill named ${name} (have: ${SKILLS.map((s) => s.name).join(", ")})`);
			out.stdout(options.stub ? found.stub : found.body);
		});

	program
		.command("init")
		.description("Install skill stubs, a quest root, and agent pointers for this repository")
		.action(() => {
			const changes = init(root());
			for (const line of theme ? theme.init(changes) : changes) print(line);
		});

	program
		.command("uninstall")
		.description("Remove Quest stubs and markers installed by `quest init`")
		.action(() => {
			const changes = uninstall(root());
			for (const line of theme ? theme.uninstall(changes) : changes) print(line);
		});

	try {
		program.parse(gateBoundary(argv), { from: "user" });
		return pending ?? code;
	} catch (error) {
		if (error instanceof CommanderError) {
			// Help and version exit 0; any other parse failure is a usage error.
			return error.exitCode === 0 ? 0 : 2;
		}
		if (error instanceof UsageError || error instanceof GitHubInputError) {
			out.stderr(`error: ${error.message}\n`);
			return 2;
		}
		warn(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

/** An empty path names no directory, so it is a usage error rather than `.`. */
function nonEmpty(value: string): string {
	if (value === "") throw new InvalidArgumentError("a value is required");
	return value;
}

/**
 * `path` as a repository-relative path, when it names a file inside `root` by
 * its filesystem path (absolute, or relative to the working directory).
 */
function withinRoot(root: string, path: string): string | null {
	try {
		const rel = relative(realpathSync(root), realpathSync(resolve(path)));
		if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") return null;
		return rel.split(sep).join("/");
	} catch {
		return null;
	}
}

/** A deadline must be finite, positive, and safe for the platform's timer. */
function positiveSeconds(value: string): number {
	const seconds = Number(value);
	if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2_147_483_647) {
		throw new InvalidArgumentError("timeout must be positive seconds, at most 2147483.647");
	}
	return seconds;
}

/**
 * Stop option parsing before a gated executable, keeping its own flags intact.
 * Quest's global options still apply on either side of `gate`.
 */
export function gateBoundary(argv: string[]): string[] {
	const skipRoot = (index: number) => {
		while (argv[index] === "--root" || argv[index]?.startsWith("--root=")) {
			index += argv[index] === "--root" ? 2 : 1;
		}
		return index;
	};
	const index = skipRoot(0);
	if (argv[index] !== "gate") return argv;
	const command = skipRoot(index + 1);
	if (!argv[command] || ["--", "-h", "--help", "-V", "--version"].includes(argv[command])) return argv;
	return [...argv.slice(0, command), "--", ...argv.slice(command)];
}

/** Parses a positive, safe integer option named `name`. */
function positiveInteger(name: string): (value: string) => number {
	return (value) => {
		const count = Number(value);
		if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count <= 0) {
			throw new InvalidArgumentError(`${name} must be a positive safe integer`);
		}
		return count;
	};
}
