//! Filesystem adapters for the native CLI.

use crate::{Doc, Finding, branch, rules};
use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};

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
		} else if crate::is_quest(&path) {
			out.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
		}
	}
	Ok(())
}

/// Parse and validate the tree. Returns every finding, worst-case empty.
pub fn check(root: &Path) -> Result<Vec<Finding>> {
	Ok(rules::check(&load(root)?, |path| root.join(path).exists()))
}

/// Every quest document, parsed, in tree order.
pub(crate) fn load(root: &Path) -> Result<Vec<Doc>> {
	let paths = collect(root)?;
	if paths.is_empty() {
		bail!("no quest documents found under {}", root.join("quest").display());
	}
	paths.into_iter().map(|p| Doc::parse(root, p)).collect()
}

/// [`load`], with each line read from its branch on `remote` when one is given.
pub(crate) fn load_from(root: &Path, remote: Option<&str>) -> Result<Vec<Doc>> {
	let docs = load(root)?;
	match remote {
		Some(remote) => branch::overlay(root, docs, remote),
		None => Ok(docs),
	}
}
