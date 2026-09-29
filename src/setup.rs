//! `quest init` and `quest uninstall`: install skill stubs and reverse it.
//!
//! Init touches only stubs, one reference line, `/.scratch/` in `.gitignore`, and
//! an empty `quest/README.md` when missing. Uninstall never deletes the quest tree.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::skills;

/// Appended to the root agent instructions when Quest is installed.
pub const REFERENCE_LINE: &str = "When work mentions a quest, run `quest guide` and follow it.";

const SCRATCH_IGNORE: &str = "/.scratch/";

const QUEST_ROOT_README: &str = "\
# Quests

## Goal

What this project is working toward.
";

/// Install Quest stubs and markers under `root`. Returns paths changed.
pub fn init(root: &Path) -> Result<Vec<PathBuf>> {
	let mut changes = Vec::new();
	let skills_dir = ensure_skills_layout(root, &mut changes)?;
	install_stubs(&skills_dir, &mut changes)?;
	if write_quest_readme(root)? {
		changes.push(root.join("quest/README.md"));
	}
	if append_gitignore_scratch(root)? {
		changes.push(root.join(".gitignore"));
	}
	if append_reference_line(root)? {
		changes.push(instructions_path(root));
	}
	Ok(changes)
}

/// Remove Quest-owned files under `root`. Returns paths changed.
pub fn uninstall(root: &Path) -> Result<Vec<PathBuf>> {
	let mut changes = Vec::new();
	if let Some(skills_dir) = skills_root(root)? {
		remove_stubs(&skills_dir, &mut changes)?;
		clean_skills_layout(root, &mut changes)?;
	}
	if remove_gitignore_scratch(root)? {
		changes.push(root.join(".gitignore"));
	}
	changes.extend(remove_reference_lines(root)?);
	Ok(changes)
}

fn skills_root(root: &Path) -> Result<Option<PathBuf>> {
	let claude = root.join(".claude/skills");
	let agents = root.join(".agents/skills");
	let claude_meta = meta(&claude);
	let agents_meta = meta(&agents);
	match (claude_meta, agents_meta) {
		(None, None) => Ok(None),
		(Some(kind), None) if kind.is_dir() => Ok(Some(claude)),
		(None, Some(kind)) if kind.is_dir() => Ok(Some(agents)),
		(Some(claude_kind), Some(agents_kind)) if claude_kind.is_dir() && agents_kind.is_symlink() => Ok(Some(claude)),
		(Some(claude_kind), Some(agents_kind)) if agents_kind.is_dir() && claude_kind.is_symlink() => Ok(Some(agents)),
		(Some(claude_kind), Some(agents_kind)) if claude_kind.is_dir() && agents_kind.is_dir() => {
			bail!(
				"both .claude/skills and .agents/skills exist as directories; \
				 remove one or symlink them before running `quest init`"
			);
		}
		_ => Ok(None),
	}
}

fn meta(path: &Path) -> Option<std::fs::FileType> {
	std::fs::symlink_metadata(path).ok().map(|m| m.file_type())
}

fn ensure_skills_layout(root: &Path, changes: &mut Vec<PathBuf>) -> Result<PathBuf> {
	let claude = root.join(".claude/skills");
	let agents = root.join(".agents/skills");
	let claude_meta = meta(&claude);
	let agents_meta = meta(&agents);

	match (claude_meta, agents_meta) {
		(None, None) => {
			std::fs::create_dir_all(&claude).context("create .claude/skills")?;
			changes.push(claude.clone());
			link_dir(&agents, &claude, changes)?;
			Ok(claude)
		}
		(Some(kind), None) if kind.is_dir() => {
			link_dir(&agents, &claude, changes)?;
			Ok(claude)
		}
		(None, Some(kind)) if kind.is_dir() => {
			link_dir(&claude, &agents, changes)?;
			Ok(agents)
		}
		(Some(claude_kind), Some(agents_kind)) if claude_kind.is_dir() && agents_kind.is_symlink() => Ok(claude),
		(Some(claude_kind), Some(agents_kind)) if agents_kind.is_dir() && claude_kind.is_symlink() => Ok(agents),
		(Some(claude_kind), Some(agents_kind)) if claude_kind.is_dir() && agents_kind.is_dir() => {
			bail!(
				"both .claude/skills and .agents/skills exist as directories; \
				 remove one or symlink them before running `quest init`"
			);
		}
		_ => bail!("unexpected .claude/skills or .agents/skills layout"),
	}
}

fn link_dir(link: &Path, target: &Path, changes: &mut Vec<PathBuf>) -> Result<()> {
	if link.exists() {
		return Ok(());
	}
	let parent = link.parent().context("skills parent")?;
	std::fs::create_dir_all(parent).context("create agent config dir")?;
	let rel = relative_skills_link(parent, target);
	#[cfg(unix)]
	{
		std::os::unix::fs::symlink(&rel, link).with_context(|| format!("symlink {}", link.display()))?;
	}
	#[cfg(not(unix))]
	{
		bail!("directory symlinks for skills require a Unix platform");
	}
	changes.push(link.to_path_buf());
	Ok(())
}

/// Relative path from `link_parent` to `skills_dir`, for the two layouts init creates.
fn relative_skills_link(link_parent: &Path, skills_dir: &Path) -> PathBuf {
	if link_parent.ends_with(".agents") && skills_dir.ends_with(".claude/skills") {
		PathBuf::from("../.claude/skills")
	} else if link_parent.ends_with(".claude") && skills_dir.ends_with(".agents/skills") {
		PathBuf::from("../.agents/skills")
	} else {
		PathBuf::from(skills_dir)
	}
}

fn install_stubs(skills_dir: &Path, changes: &mut Vec<PathBuf>) -> Result<()> {
	for skill in skills::all() {
		let dir = skills_dir.join(skill.installed());
		let path = dir.join("SKILL.md");
		if path.is_file() {
			let existing = std::fs::read_to_string(&path).with_context(|| path.display().to_string())?;
			if existing == skill.stub() {
				continue;
			}
			bail!(
				"{} is not a Quest stub; remove or rename it before running `quest init`",
				path.display()
			);
		} else if dir.exists() {
			bail!(
				"{} exists without SKILL.md; remove or rename it before running `quest init`",
				dir.display()
			);
		}
		std::fs::create_dir_all(&dir).context("create skill dir")?;
		std::fs::write(&path, skill.stub()).with_context(|| path.display().to_string())?;
		changes.push(path);
	}
	Ok(())
}

fn write_quest_readme(root: &Path) -> Result<bool> {
	let path = root.join("quest/README.md");
	if path.exists() {
		return Ok(false);
	}
	std::fs::create_dir_all(path.parent().unwrap()).context("create quest/")?;
	std::fs::write(&path, QUEST_ROOT_README).context("write quest/README.md")?;
	Ok(true)
}

fn append_gitignore_scratch(root: &Path) -> Result<bool> {
	let path = root.join(".gitignore");
	if path.is_file() {
		let content = std::fs::read_to_string(&path).context("read .gitignore")?;
		if content.lines().any(|line| line == SCRATCH_IGNORE) {
			return Ok(false);
		}
		let mut out = content;
		if !out.ends_with('\n') {
			out.push('\n');
		}
		out.push_str(SCRATCH_IGNORE);
		out.push('\n');
		std::fs::write(&path, out).context("update .gitignore")?;
	} else {
		std::fs::write(&path, format!("{SCRATCH_IGNORE}\n")).context("write .gitignore")?;
	}
	Ok(true)
}

fn instructions_path(root: &Path) -> PathBuf {
	if root.join("AGENTS.md").is_file() {
		root.join("AGENTS.md")
	} else if root.join("CLAUDE.md").is_file() {
		root.join("CLAUDE.md")
	} else {
		root.join("AGENTS.md")
	}
}

fn append_reference_line(root: &Path) -> Result<bool> {
	let path = instructions_path(root);
	if path.is_file() {
		let content = std::fs::read_to_string(&path).context("read agent instructions")?;
		if content.lines().any(|line| line == REFERENCE_LINE) {
			return Ok(false);
		}
		let mut out = content;
		if !out.is_empty() && !out.ends_with('\n') {
			out.push('\n');
		}
		if !out.is_empty() {
			out.push('\n');
		}
		out.push_str(REFERENCE_LINE);
		out.push('\n');
		std::fs::write(&path, out).context("update agent instructions")?;
	} else {
		std::fs::write(&path, format!("{REFERENCE_LINE}\n")).context("write agent instructions")?;
	}
	Ok(true)
}

fn remove_stubs(skills_dir: &Path, changes: &mut Vec<PathBuf>) -> Result<()> {
	for skill in skills::all() {
		let path = skills_dir.join(skill.installed()).join("SKILL.md");
		if !path.is_file() {
			continue;
		}
		let existing = std::fs::read_to_string(&path).with_context(|| path.display().to_string())?;
		if existing != skill.stub() {
			continue;
		}
		std::fs::remove_file(&path).with_context(|| path.display().to_string())?;
		changes.push(path);
		let dir = skills_dir.join(skill.installed());
		if dir.read_dir()?.next().is_none() {
			std::fs::remove_dir(&dir).with_context(|| dir.display().to_string())?;
			changes.push(dir);
		}
	}
	Ok(())
}

fn clean_skills_layout(root: &Path, changes: &mut Vec<PathBuf>) -> Result<()> {
	let claude = root.join(".claude/skills");
	let agents = root.join(".agents/skills");
	for dir in [&claude, &agents] {
		if dir.is_dir() && dir.read_dir()?.next().is_none() {
			std::fs::remove_dir(dir).with_context(|| dir.display().to_string())?;
			changes.push(dir.clone());
		}
	}
	for link in [&agents, &claude] {
		if link.is_symlink() {
			let target = link.parent().unwrap().join(std::fs::read_link(link)?);
			if !target.exists() {
				std::fs::remove_file(link).with_context(|| link.display().to_string())?;
				changes.push(link.clone());
			}
		}
	}
	Ok(())
}

fn remove_gitignore_scratch(root: &Path) -> Result<bool> {
	let path = root.join(".gitignore");
	if !path.is_file() {
		return Ok(false);
	}
	let content = std::fs::read_to_string(&path).context("read .gitignore")?;
	let filtered: Vec<_> = content.lines().filter(|line| *line != SCRATCH_IGNORE).collect();
	if filtered.len() == content.lines().count() {
		return Ok(false);
	}
	if filtered.is_empty() {
		std::fs::remove_file(&path).context("remove .gitignore")?;
	} else {
		let mut out = filtered.join("\n");
		out.push('\n');
		std::fs::write(&path, out).context("update .gitignore")?;
	}
	Ok(true)
}

fn remove_reference_lines(root: &Path) -> Result<Vec<PathBuf>> {
	let mut changes = Vec::new();
	for name in ["AGENTS.md", "CLAUDE.md"] {
		let path = root.join(name);
		if !path.is_file() {
			continue;
		}
		let content = std::fs::read_to_string(&path).context("read agent instructions")?;
		let filtered: Vec<_> = content.lines().filter(|line| *line != REFERENCE_LINE).collect();
		if filtered.len() == content.lines().count() {
			continue;
		}
		let mut out = filtered.join("\n");
		if content.ends_with('\n') {
			out.push('\n');
		}
		if out.trim().is_empty() {
			std::fs::remove_file(&path).context("remove agent instructions")?;
		} else {
			std::fs::write(&path, out).context("update agent instructions")?;
		}
		changes.push(path);
	}
	Ok(changes)
}
