// The `quest` command line: argument parsing and output around the core.

import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { Command, CommanderError } from "commander";

import { description, version } from "../../package.json";
import { blockers, check, formatFinding, label, ready, renderBlocker } from "../core";
import { init, uninstall } from "./setup";
import { GUIDE, SKILLS, skill } from "./skills";
import { collect, exists, load } from "./tree";

/** Where the command writes; the process streams, or a buffer under test. */
export interface Output {
	stdout(text: string): void;
	stderr(text: string): void;
}

/** A failure the user caused rather than the command, reported as a usage error. */
class UsageError extends Error {}

/** Run the CLI with `argv` (arguments only, no executable). Returns the exit code. */
export function main(argv: string[], out: Output): number {
	let code = 0;
	const print = (line: string) => out.stdout(`${line}\n`);
	const warn = (line: string) => out.stderr(`quest: ${line}\n`);

	const program = new Command("quest")
		.description(description)
		.version(`quest ${version}`, "-V, --version", "Print version")
		.helpOption("-h, --help", "Print help")
		.helpCommand("help [command]", "Print this message or the help of the given subcommand")
		.option("--root <root>", "Repository root holding the quest/ directory", ".")
		.configureOutput({ writeOut: out.stdout, writeErr: out.stderr })
		.exitOverride();
	const root = () => program.opts<{ root: string }>().root;

	program
		.command("check")
		.description("Report every structural mistake in the tree; exit non-zero if any")
		.action(() => {
			const findings = check(load(root()), (path) => exists(root(), path));
			if (findings.length === 0) {
				print(`quest: ${collect(root()).length} documents ok`);
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
				"Exits 0 either way: the blocker list on stdout is the result, so no output means ready and a caller " +
				"tests that rather than parsing prose. A non-zero exit means the command itself failed.",
		)
		.argument("[path]", "Quest to explain. Omit to list every ready quest in tree order")
		.action((path?: string) => {
			const docs = load(root());
			if (path === undefined) {
				for (const quest of ready(docs)) print(quest);
				return;
			}
			const found = blockers(docs, path) ?? blockers(docs, withinRoot(root(), path) ?? path);
			if (found === null) throw new Error(`${path} is not a quest document under ${resolveQuest(root())}`);
			for (const blocker of found) {
				for (const line of renderBlocker(blocker)) print(line);
				warn(`blocked by ${label(blocker)}`);
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
		.command("guide")
		.description("Print the quest guide: the format, workflow, and rules agents follow")
		.action(() => out.stdout(GUIDE));

	program
		.command("skill")
		.summary("Print a skill's instructions, or list the skills with no name")
		.description(
			"Print a skill's instructions, or list the skills with no name.\n\n" +
				"A repository installs only a stub per skill, which runs this, so the pinned version decides what " +
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
			for (const path of init(root())) print(path);
		});

	program
		.command("uninstall")
		.description("Remove Quest stubs and markers installed by `quest init`")
		.action(() => {
			for (const path of uninstall(root())) print(path);
		});

	try {
		program.parse(argv, { from: "user" });
		return code;
	} catch (error) {
		if (error instanceof CommanderError) {
			// Help and version exit 0; any other parse failure is a usage error.
			return error.exitCode === 0 ? 0 : 2;
		}
		if (error instanceof UsageError) {
			out.stderr(`error: ${error.message}\n`);
			return 2;
		}
		warn(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

/** The quest directory under `root`, as a user would name it in an error. */
function resolveQuest(root: string): string {
	return `${root.replace(/\/+$/, "")}/quest`;
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
