// The `quest` command line: argument parsing and output around the core.

import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { description, version } from "../../package.json";
import { blockers, check, formatFinding, label, lookup, ready, renderBlocker } from "../core";
import { init, uninstall } from "./setup";
import { GUIDE, SKILLS, skill } from "./skills";
import { type Terminal, Theme } from "./theme";
import { collect, exists, load, under } from "./tree";
import { pullRequest, waitDependencies, waitForActivity, WaitInputError, WaitTimeout } from "./wait";

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

	program
		.command("ready")
		.summary("Print what blocks a quest, or list every ready quest")
		.description(
			"Print what blocks a quest, or list every ready quest.\n\n" +
				"Exits 0 either way; a non-zero exit means the command itself failed. Piped, the blocker list on " +
				"stdout is the result, so no output means ready and a caller tests that rather than parsing prose.\n\n" +
				"On a terminal, ready prints a quest log instead: a yellow ! for a ready quest, a grey ! for a " +
				"blocked one, its size in its size colour, its title, and its path. Set NO_COLOR to drop the colours.",
		)
		.argument("[path]", "Quest to explain. Omit to list every ready quest in tree order")
		.action((path?: string) => {
			const docs = load(root());
			const byPath = new Map(docs.map((doc) => [doc.path, doc]));
			if (path === undefined) {
				const quests = ready(docs);
				for (const line of theme ? theme.ready(byPath, quests) : quests) print(line);
				return;
			}
			const inside = withinRoot(root(), path);
			const doc = lookup(docs, path) ?? (inside === null ? null : lookup(docs, inside));
			if (doc === null) throw new Error(`${path} is not a quest document under ${under(root(), "quest")}`);
			const found = blockers(docs, doc);
			if (theme) {
				// The themed log already names every blocker; stderr keeps only the advice.
				for (const line of theme.blockers(byPath, doc, found)) print(line);
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
		});

	program
		.command("wait")
		.summary("Wait for pull request activity on GitHub")
		.description(
			"Wait for a review, comment, review-thread reply, reaction to the PR or a review, push, merge, close, " +
				"or merge-queue removal. Polls every 5 minutes; rate limits delay requests. No timeout by default.\n\n" +
				"Prints one plain line per event: timestamp (or commit SHA), type, actor, URL; the last line adds a resume cursor. " +
				"Reactions print as reacted:<content>, such as reacted:thumbs_up. " +
				"Pass the final field of the last line to --since to resume without replaying events.\n\n" +
				"Uses GH_TOKEN, GITHUB_TOKEN, or gh auth token. Replies and reactions by that account are ignored. " +
				"Exits 0 for activity, 3 on timeout, 2 for invalid arguments, and 1 for other failures. " +
				"Check runs and edits are not activity.",
		)
		.argument("<pr>", "GitHub PR URL, or a PR number in origin")
		.option("--since <point>", "ISO timestamp, pushed-tip SHA, or resume cursor (default: current head push time)")
		.option("--timeout <seconds>", "Maximum wait in seconds", positiveSeconds)
		.action((value: string, options: { since?: string; timeout?: number }) => {
			const pr = pullRequest(value, root());
			const deps = waitDependencies();
			deps.warn = warn;
			pending = waitForActivity(pr, options, deps).then(
				(lines) => {
					for (const line of lines) print(line);
					return 0;
				},
				(error: unknown) => {
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
