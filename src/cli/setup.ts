// `quest init` and `quest uninstall`: install skill stubs and reverse it.
//
// Init touches only stubs, one reference line, and an empty `quest/README.md`
// when missing. Uninstall never deletes the quest tree.

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	rmdirSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { SKILLS } from "./skills";

/**
 * Marks Quest's line in the root agent instructions, so a repository can
 * reword the rest of it without init adding another.
 */
const REFERENCE_MARKER = "Quests: ";

/** Appended to the root agent instructions when Quest is installed. */
export const REFERENCE_LINE = "Quests: when work mentions a quest, run `quest guide` and follow it.";

/** The skill directories Claude Code and Codex read. One holds the stubs and the other links to it. */
const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

const QUEST_ROOT_README = "# Quests\n\n## Goal\n\nWhat this project is working toward.\n";

/**
 * Install Quest stubs and markers under `root`. Returns the paths it changed, relative to `root`.
 * A conflict throws before anything is written, so a refused init leaves the repository as it was.
 */
export function init(root: string): string[] {
	for (const dir of SKILL_DIRS) checkPath(root, dirname(dir), "directory");
	const { real, link } = skillDirs(root);
	const missing = SKILLS.filter((skill) => {
		const dir = `${real}/${skill.installed}`;
		const path = `${dir}/SKILL.md`;
		checkPath(root, path, "file");
		if (isFile(join(root, path))) {
			if (read(root, path) === skill.stub) return false;
			throw new Error(`${path} is not a Quest stub; remove or rename it before running \`quest init\``);
		} else if (existsSync(join(root, dir))) {
			throw new Error(`${dir} exists without SKILL.md; remove or rename it before running \`quest init\``);
		}
		return true;
	});
	const readme = "quest/README.md";
	checkPath(root, readme, "file");
	const instructions = ["AGENTS.md", "CLAUDE.md"].find((name) => isFile(join(root, name))) ?? "AGENTS.md";
	checkPath(root, instructions, "file");

	const changes: string[] = [];
	mkdirSync(join(root, real), { recursive: true });
	const linkPath = join(root, link);
	if (!isSymlink(linkPath)) {
		mkdirSync(dirname(linkPath), { recursive: true });
		symlinkSync(join("..", real), linkPath);
		changes.push(link);
	}
	for (const skill of missing) {
		const dir = `${real}/${skill.installed}`;
		mkdirSync(join(root, dir), { recursive: true });
		writeFileSync(join(root, dir, "SKILL.md"), skill.stub);
		changes.push(`${dir}/SKILL.md`);
	}

	if (!existsSync(join(root, readme))) {
		mkdirSync(join(root, "quest"), { recursive: true });
		writeFileSync(join(root, readme), QUEST_ROOT_README);
		changes.push(readme);
	}

	if (appendLine(root, instructions, REFERENCE_MARKER, REFERENCE_LINE)) changes.push(instructions);
	return changes;
}

/** Check an install destination and its parents before any writes, following valid symlinks. */
function checkPath(root: string, path: string, expected: "directory" | "file"): void {
	const parent = dirname(path);
	if (parent !== ".") checkPath(root, parent, "directory");
	const absolute = join(root, path);
	let stat;
	try {
		stat = statSync(absolute);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		if (kind(absolute) === null) return;
	}
	if (expected === "directory" ? stat?.isDirectory() : stat?.isFile()) return;
	throw new Error(`${path} is not a ${expected}; remove or rename it before running \`quest init\``);
}

/** Remove Quest stubs and markers under `root`. Returns the paths it changed, relative to `root`. */
export function uninstall(root: string): string[] {
	const changes: string[] = [];
	for (const skills of SKILL_DIRS) {
		if (!isRealDir(join(root, skills))) continue;
		for (const skill of SKILLS) {
			const dir = `${skills}/${skill.installed}`;
			const path = `${dir}/SKILL.md`;
			if (!isFile(join(root, path)) || read(root, path) !== skill.stub) continue;
			rmSync(join(root, path));
			changes.push(path);
			removeIfEmpty(join(root, dir));
		}
		removeIfEmpty(join(root, skills));
	}
	// A link whose target just went away was the one init made.
	for (const skills of SKILL_DIRS) {
		const link = join(root, skills);
		if (isSymlink(link) && !existsSync(link)) {
			rmSync(link);
			changes.push(skills);
		}
		const parent = dirname(link);
		if (isRealDir(parent)) removeIfEmpty(parent);
	}

	for (const path of ["AGENTS.md", "CLAUDE.md"]) {
		if (removeLine(root, path, REFERENCE_MARKER)) changes.push(path);
	}
	return changes;
}

/**
 * Which skill directory holds the stubs and which links to it: the one that is
 * already a directory, or `.claude/skills` when neither exists. Writes nothing.
 */
function skillDirs(root: string): { real: string; link: string } {
	const [claude, agents] = SKILL_DIRS.map((dir) => kind(join(root, dir)));
	if (claude === "dir" && agents === "dir") {
		throw new Error(
			"both .claude/skills and .agents/skills are directories; merge them and link one to the other before running `quest init`",
		);
	} else if (claude === "dir" && (agents === null || agents === "symlink")) {
		return { real: SKILL_DIRS[0], link: SKILL_DIRS[1] };
	} else if (agents === "dir" && (claude === null || claude === "symlink")) {
		return { real: SKILL_DIRS[1], link: SKILL_DIRS[0] };
	} else if (claude === null && agents === null) {
		return { real: SKILL_DIRS[0], link: SKILL_DIRS[1] };
	}
	throw new Error("unexpected .claude/skills or .agents/skills layout; link one directory to the other");
}

/** What sits at `path` without following a symlink, or `null` for nothing. */
function kind(path: string): "dir" | "symlink" | "other" | null {
	try {
		const stat = lstatSync(path);
		return stat.isDirectory() ? "dir" : stat.isSymbolicLink() ? "symlink" : "other";
	} catch {
		return null;
	}
}

function isSymlink(path: string): boolean {
	return kind(path) === "symlink";
}

function isRealDir(path: string): boolean {
	return kind(path) === "dir";
}

/** A regular file, following symlinks. */
function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function removeIfEmpty(dir: string) {
	if (readdirSync(dir).length === 0) rmdirSync(dir);
}

function read(root: string, path: string): string {
	return readFileSync(join(root, path), "utf8");
}

/** Lines without their terminators, as Markdown editors on any platform wrote them. */
function lines(content: string): string[] {
	const out = content.split(/\r?\n/);
	if (out[out.length - 1] === "") out.pop();
	return out;
}

/**
 * Append `line` unless a line already starts with `marker`, creating the file
 * if missing, separated from existing content by a blank line.
 */
function appendLine(root: string, path: string, marker: string, line: string): boolean {
	let content = isFile(join(root, path)) ? read(root, path) : "";
	if (lines(content).some((existing) => existing.startsWith(marker))) return false;
	if (content !== "") {
		if (!content.endsWith("\n")) content += "\n";
		content += "\n";
	}
	writeFileSync(join(root, path), `${content}${line}\n`);
	return true;
}

/**
 * Remove every line starting with `marker` and the blank lines it leaves at the
 * end, deleting the file if nothing else remains.
 */
function removeLine(root: string, path: string, marker: string): boolean {
	if (!isFile(join(root, path))) return false;
	const content = lines(read(root, path));
	if (!content.some((existing) => existing.startsWith(marker))) return false;
	const kept = content
		.filter((existing) => !existing.startsWith(marker))
		.join("\n")
		.trimEnd();
	if (kept === "") {
		rmSync(join(root, path));
	} else {
		writeFileSync(join(root, path), `${kept}\n`);
	}
	return true;
}
