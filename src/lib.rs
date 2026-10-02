//! The quest tree, whose contract is the guide in [`skills::GUIDE`]: structural
//! validation of it, whether a given quest can be started, which branches carry
//! it, and the agent skills that work it.
//!
//! The whole tree is validated on every run, never just the changed files: the
//! link graph and the questline index are global, so completing one quest
//! breaks files the diff never mentions. That is not hypothetical - it is how
//! the index entry for a completed quest survived a rebase that produced no
//! conflict at all.

pub mod branch;
pub mod doc;
pub mod ready;
pub mod rules;
pub mod setup;
pub mod skills;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

pub use doc::Doc;
pub use ready::Blocker;
pub use rules::Finding;

/// Agent instructions are not quests, including the quest/AGENTS.md older
/// versions installed and CLAUDE.md files in adopting repositories. Neither
/// filename is indexed or validated.
const NOT_QUESTS: [&str; 2] = ["AGENTS.md", "CLAUDE.md"];

/// Every quest document under `<root>/quest`, sorted, repository-relative.
pub fn collect(root: &Path) -> Result<Vec<PathBuf>> {
	let mut out = Vec::new();
	walk(root, &root.join("quest"), &mut out).with_context(|| format!("scanning {}", root.join("quest").display()))?;
	out.sort();
	Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		let path = entry.path();
		// `file_type` does not follow symlinks, so a symlinked AGENTS.md is a file
		// here and a directory symlink can never make this recurse forever.
		let kind = entry.file_type()?;
		if kind.is_dir() {
			walk(root, &path, out)?;
		} else if is_quest(&path) {
			out.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
		}
	}
	Ok(())
}

/// A Markdown file other than agent instructions.
fn is_quest(path: &Path) -> bool {
	path.extension().is_some_and(|e| e == "md")
		&& !path
			.file_name()
			.is_some_and(|n| NOT_QUESTS.iter().any(|skip| n == *skip))
}

/// Parse and validate the tree. Returns every finding, worst-case empty.
pub fn check(root: &Path) -> Result<Vec<Finding>> {
	Ok(rules::check(root, &load(root)?))
}

/// Every quest document, parsed, in tree order.
fn load(root: &Path) -> Result<Vec<Doc>> {
	let paths = collect(root)?;
	if paths.is_empty() {
		bail!("no quest documents found under {}", root.join("quest").display());
	}
	paths.into_iter().map(|p| Doc::parse(root, p)).collect()
}

/// [`load`], with each line read from its branch on `remote` when one is given.
fn load_from(root: &Path, remote: Option<&str>) -> Result<Vec<Doc>> {
	let docs = load(root)?;
	match remote {
		Some(remote) => branch::overlay(root, docs, remote),
		None => Ok(docs),
	}
}
