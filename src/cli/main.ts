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
	renderBlocker,
	unblocked,
} from "../core";
import { claims, questBranch } from "./claims";
import { githubDependencies } from "./github";
import { init, uninstall } from "./setup";
import { Refusal, describe, releaseQuest, startQuest } from "./start";
import { GUIDE, SKILLS, skill } from "./skills";
import { type Terminal, Theme } from "./theme";
import { collect, exists, load, under } from "./tree";
import { pullRequest, waitForActivity, WaitInputError, WaitTimeout } from "./wait";

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
		.command("check")
		.description("Report every structural mistake in the tree; exit non-zero if any")
		.action(() => {
			const findings = check(load(root()), (path) => exists(root(), path));
			if (findings.length === 0) {
				const count = collect(root()).length;
				print(theme ? theme.checked(count) : `quest: ${count} documents ok`);
				return;
			}
			for (const finding of findings) warn(formatFinding(finding));
			code = 1;
		});

	/** The quest document `path` names, as the tree writes it, as the shell completes it, or as a filesystem path. */
	const find = (docs: Doc[], path: string): Doc => {
		const inside = withinRoot(root(), path);
		const doc = lookup(docs, path) ?? (inside === null ? null : lookup(docs, inside));
		if (doc === null) throw new Error(`${path} is not a quest document under ${under(root(), "quest")}`);
		return doc;
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
	const settle = <T>(work: Promise<T>, done: (result: T) => void) => {
		pending = work.then(
			(result) => {
				done(result);
				return 0;
			},
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
				"--unclaimed drops quests someone holds: a quest branch upstream, or an open PR from that branch in " +
				"any repository. A GitHub fork's upstream is its parent. Each skipped quest is listed on stderr with " +
				"its PR and how long ago that PR was last active, so a stale claim can be offered for takeover. Off " +
				"GitHub, only branches are checked. Outside conditions are never checked.\n\n" +
				"Given a path, piped output lists its blockers, one per line with nesting indented, with an " +
				"explanation on stderr; no output means it is ready. On a terminal it prints a quest log instead: a " +
				"yellow ! for a ready quest, a grey ! for a blocked one, and each size label in its colour. Set " +
				"NO_COLOR to drop the colours. Exits 0 whether or not the quest is blocked; non-zero means the " +
				"command failed.",
		)
		.argument("[path]", "Quest to explain instead of ranking every ready quest")
		.option("--json", "Print a deterministic JSON array")
		.option("--limit <count>", "Maximum number of ready quests to print", positiveInteger)
		.option("--unclaimed", "Skip quests with a claim branch or open PR, listing them on stderr")
		.option("--remote <name>", "Remote whose upstream holds the claims", "origin")
		.action(
			(
				path: string | undefined,
				options: { json?: boolean; limit?: number; unclaimed?: boolean; remote: string },
			) => {
				const docs = load(root());
				if (path !== undefined) {
					if (options.json || options.limit !== undefined || options.unclaimed) {
						throw new UsageError("--json, --limit, and --unclaimed apply to the ranking; omit the path");
					}
					explain(docs, find(docs, path), path);
					return;
				}
				const findings = check(docs, (path) => exists(root(), path));
				if (findings.length > 0) {
					for (const finding of findings) warn(formatFinding(finding));
					code = 1;
					return;
				}
				const ranked = unblocked(docs);
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
					show(ranked);
					return;
				}
				const branches = ranked.map((quest) => questBranch(quest.path));
				settle(claims(root(), options.remote, branches, { github: githubDependencies, warn }), (held) => {
					const byBranch = new Map(held.map((claim) => [claim.branch, claim]));
					const now = Date.now();
					for (const quest of ranked) {
						const claim = byBranch.get(questBranch(quest.path));
						if (claim) warn(`skipped ${quest.path}: held by ${describe(claim.branch, claim.pull, now)}`);
					}
					show(ranked.filter((quest) => !byBranch.has(questBranch(quest.path))));
				});
			},
		);

	program
		.command("start")
		.summary("Claim a ready quest with a draft PR, or release that claim")
		.description(
			"Claim a ready quest: push an empty claim commit, built on the upstream default branch, to the quest's " +
				"branch (its path without .md) without forcing, then open a draft PR from it right away. Creates the " +
				"local branch when that name is free, and prints the PR URL, or the branch off GitHub.\n\n" +
				"Refuses a blocked quest, one missing from the upstream default branch, and one already held: a " +
				"branch upstream or an open PR from that branch in any repository. A rejected push means someone " +
				"else pushed the branch first. When two PRs race, as from forks, the earliest open PR keeps the " +
				"claim; a later one is closed and its branch deleted.\n\n" +
				"The remote's upstream holds claims: a GitHub fork pushes the branch to itself and opens the PR on its " +
				"parent. Off GitHub, only the branch is pushed, with a warning.\n\n" +
				"--release deletes the quest's branch on the remote, with a lease on its tip, and closes its PR, only " +
				"while that tip is still an empty commit.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token on GitHub. Exits 0 when done, 3 when refused " +
				"(blocked, held, or work on the branch), 2 for invalid arguments, and 1 for other failures.",
		)
		.argument("<quest>", "Quest to claim, as /quest/..., quest/..., or a filesystem path")
		.option("--release", "Release the claim instead: delete the empty claim branch and close its PR")
		.option("--remote <name>", "Remote to push the claim to", "origin")
		.action((path: string, options: { release?: boolean; remote: string }) => {
			const docs = load(root());
			const doc = find(docs, path);
			const deps = { github: githubDependencies, warn };
			if (options.release) {
				settle(releaseQuest(root(), doc.path, options.remote, deps), (released) => {
					print(`deleted ${released.branch}`);
					for (const url of released.closed) print(`closed ${url}`);
				});
				return;
			}
			if (blockers(docs, doc).length > 0) {
				explain(docs, doc, path);
				code = 3;
				return;
			}
			settle(startQuest(root(), doc.path, doc.title?.text ?? doc.path, options.remote, deps), (started) =>
				print(started.url ?? started.branch),
			);
		});

	program
		.command("wait")
		.summary("Wait for pull request activity on GitHub")
		.description(
			"Wait for a review, comment, review-thread reply, reaction to the PR or a review, push, merge, close, " +
				"merge-queue removal, or disabled auto-merge. Polls every 5 minutes; rate limits delay requests. No timeout by default.\n\n" +
				"Prints one plain line per event: timestamp (or commit SHA), type, actor, URL; the last line adds a resume cursor. " +
				"Reactions print as reacted:<content>, such as reacted:thumbs_up. " +
				"Pass the final field of the last line to --since to resume without replaying events. " +
				"On timeout, the only line is a resume point for --since (a cursor, or the given --since or head SHA if setup did not finish), so a retry with it still reports activity from the first wait.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token. Replies and reactions by that account are ignored. " +
				"Exits 0 for activity, 3 on timeout, 2 for invalid arguments, and 1 for other failures. " +
				"Check runs and edits are not activity.",
		)
		.argument("<pr>", "GitHub PR URL, or a PR number in origin")
		.option("--since <point>", "ISO timestamp, pushed-tip SHA, or resume cursor (default: current head push time)")
		.option("--timeout <seconds>", "Maximum wait in seconds", positiveSeconds)
		.action((value: string, options: { since?: string; timeout?: number }) => {
			const pr = pullRequest(value, root());
			const deps = githubDependencies();
			deps.warn = warn;
			pending = waitForActivity(pr, options, deps).then(
				(lines) => {
					for (const line of lines) print(line);
					return 0;
				},
				(error: unknown) => {
					if (error instanceof WaitTimeout && error.cursor) print(error.cursor);
					warn(error instanceof Error ? error.message : String(error));
					return error instanceof WaitTimeout ? 3 : error instanceof WaitInputError ? 2 : 1;
				},
			);
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
		program.parse(argv, { from: "user" });
		return pending ?? code;
	} catch (error) {
		if (error instanceof CommanderError) {
			// Help and version exit 0; any other parse failure is a usage error.
			return error.exitCode === 0 ? 0 : 2;
		}
		if (error instanceof UsageError || error instanceof WaitInputError) {
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

/** A result limit must be a positive, safe integer. */
function positiveInteger(value: string): number {
	const count = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count <= 0) {
		throw new InvalidArgumentError("limit must be a positive safe integer");
	}
	return count;
}
