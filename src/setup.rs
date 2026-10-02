//! `quest init` and `quest uninstall`: install skill stubs and reverse it.
//!
//! Init touches only stubs, one reference line, and an empty `quest/README.md`
//! when missing. Uninstall never deletes the quest tree.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::skills;

/// Marks Quest's line in the root agent instructions, so a repository can
/// reword the rest of it without init adding another.
const REFERENCE_MARKER: &str = "Quests: ";

/// Appended to the root agent instructions when Quest is installed.
pub const REFERENCE_LINE: &str = "Quests: when work mentions a quest, run `quest guide` and follow it.";

/// The skill directories Claude Code and Codex read. One holds the stubs and
/// the other links to it.
const SKILL_DIRS: [&str; 2] = [".claude/skills", ".agents/skills"];

const QUEST_ROOT_README: &str = "\
# Quests

## Goal

What this project is working toward.
";

/// Install Quest stubs and markers under `root`. Returns the paths it changed,
/// relative to `root`.
pub fn init(root: &Path) -> Result<Vec<PathBuf>> {
	let mut changes = Vec::new();
	let skills = link_skill_dirs(root, &mut changes)?;
	for skill in skills::all() {
		let dir = Path::new(skills).join(skill.installed());
		let path = dir.join("SKILL.md");
		if root.join(&path).is_file() {
			if read(root, &path)? == skill.stub() {
				continue;
			}
			bail!(
				"{} is not a Quest stub; remove or rename it before running `quest init`",
				path.display()
			);
		} else if root.join(&dir).exists() {
			bail!(
				"{} exists without SKILL.md; remove or rename it before running `quest init`",
				dir.display()
			);
		}
		fs::create_dir_all(root.join(&dir)).with_context(|| dir.display().to_string())?;
		write(root, &path, &skill.stub())?;
		changes.push(path);
	}

	let readme = Path::new("quest/README.md");
	if !root.join(readme).exists() {
		fs::create_dir_all(root.join("quest")).context("quest")?;
		write(root, readme, QUEST_ROOT_README)?;
		changes.push(readme.into());
	}

	let instructions = ["AGENTS.md", "CLAUDE.md"]
		.into_iter()
		.find(|name| root.join(name).is_file())
		.unwrap_or("AGENTS.md");
	if append_line(root, Path::new(instructions), REFERENCE_MARKER, REFERENCE_LINE)? {
		changes.push(instructions.into());
	}
	Ok(changes)
}

/// Remove Quest stubs and markers under `root`. Returns the paths it changed,
/// relative to `root`.
pub fn uninstall(root: &Path) -> Result<Vec<PathBuf>> {
	let mut changes = Vec::new();
	for skills in SKILL_DIRS {
		if !is_real_dir(&root.join(skills)) {
			continue;
		}
		for skill in skills::all() {
			let dir = Path::new(skills).join(skill.installed());
			let path = dir.join("SKILL.md");
			if !root.join(&path).is_file() || read(root, &path)? != skill.stub() {
				continue;
			}
			fs::remove_file(root.join(&path)).with_context(|| path.display().to_string())?;
			changes.push(path);
			remove_if_empty(&root.join(dir))?;
		}
		remove_if_empty(&root.join(skills))?;
	}
	// A link whose target just went away was the one init made.
	for skills in SKILL_DIRS {
		let link = root.join(skills);
		if link.is_symlink() && !link.exists() {
			fs::remove_file(&link).with_context(|| skills.to_string())?;
			changes.push(skills.into());
		}
		let parent = link.parent().context(skills)?;
		if is_real_dir(parent) {
			remove_if_empty(parent)?;
		}
	}

	for path in ["AGENTS.md", "CLAUDE.md"] {
		if remove_line(root, Path::new(path), REFERENCE_MARKER)? {
			changes.push(path.into());
		}
	}
	Ok(changes)
}

/// Make one skill directory real and link the other to it, creating
/// `.claude/skills` when neither exists. Returns the real one.
fn link_skill_dirs(root: &Path, changes: &mut Vec<PathBuf>) -> Result<&'static str> {
	let [claude, agents] = SKILL_DIRS.map(|dir| fs::symlink_metadata(root.join(dir)).ok().map(|meta| meta.file_type()));
	let (real, link) = match (claude, agents) {
		(Some(claude), Some(agents)) if claude.is_dir() && agents.is_dir() => bail!(
			"both .claude/skills and .agents/skills are directories; \
			 merge them and link one to the other before running `quest init`"
		),
		(Some(claude), agents) if claude.is_dir() && agents.is_none_or(|kind| kind.is_symlink()) => {
			(SKILL_DIRS[0], SKILL_DIRS[1])
		}
		(claude, Some(agents)) if agents.is_dir() && claude.is_none_or(|kind| kind.is_symlink()) => {
			(SKILL_DIRS[1], SKILL_DIRS[0])
		}
		(None, None) => {
			fs::create_dir_all(root.join(SKILL_DIRS[0])).context(SKILL_DIRS[0])?;
			(SKILL_DIRS[0], SKILL_DIRS[1])
		}
		_ => bail!("unexpected .claude/skills or .agents/skills layout; link one directory to the other"),
	};

	let link_path = root.join(link);
	if !link_path.is_symlink() {
		fs::create_dir_all(link_path.parent().context(link)?).context(link)?;
		symlink(&Path::new("..").join(real), &link_path).context(link)?;
		changes.push(link.into());
	}
	Ok(real)
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
	std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn symlink(_target: &Path, _link: &Path) -> std::io::Result<()> {
	Err(std::io::Error::other(
		"linking skill directories requires a Unix platform",
	))
}

fn is_real_dir(path: &Path) -> bool {
	fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

fn remove_if_empty(dir: &Path) -> Result<()> {
	if dir.read_dir()?.next().is_none() {
		fs::remove_dir(dir).with_context(|| dir.display().to_string())?;
	}
	Ok(())
}

fn read(root: &Path, path: &Path) -> Result<String> {
	fs::read_to_string(root.join(path)).with_context(|| path.display().to_string())
}

fn write(root: &Path, path: &Path, content: &str) -> Result<()> {
	fs::write(root.join(path), content).with_context(|| path.display().to_string())
}

/// Append `line` unless a line already starts with `marker`, creating the file
/// if missing, separated from existing content by a blank line.
fn append_line(root: &Path, path: &Path, marker: &str, line: &str) -> Result<bool> {
	let mut content = if root.join(path).is_file() {
		read(root, path)?
	} else {
		String::new()
	};
	if content.lines().any(|existing| existing.starts_with(marker)) {
		return Ok(false);
	}
	if !content.is_empty() {
		if !content.ends_with('\n') {
			content.push('\n');
		}
		content.push('\n');
	}
	content.push_str(line);
	content.push('\n');
	write(root, path, &content)?;
	Ok(true)
}

/// Remove every line starting with `marker` and the blank lines it leaves at
/// the end, deleting the file if nothing else remains.
fn remove_line(root: &Path, path: &Path, marker: &str) -> Result<bool> {
	if !root.join(path).is_file() {
		return Ok(false);
	}
	let content = read(root, path)?;
	if !content.lines().any(|existing| existing.starts_with(marker)) {
		return Ok(false);
	}
	let kept: Vec<_> = content
		.lines()
		.filter(|existing| !existing.starts_with(marker))
		.collect();
	let kept = kept.join("\n");
	let kept = kept.trim_end();
	if kept.is_empty() {
		fs::remove_file(root.join(path)).with_context(|| path.display().to_string())?;
	} else {
		write(root, path, &format!("{kept}\n"))?;
	}
	Ok(true)
}
