//! Which branch carries a quest, and which branches it merges through.
//!
//! The mapping is the path alone: a quest's branch is its path without `.md`
//! and a questline's is its README's. Milestones have no branch, so a
//! milestone's direct children merge into `main`. Naming a branch never asks
//! git, so the answer is the same on every machine and a missing line branch is
//! simply created from the next one in the chain. Only [`overlay`] reads the
//! branches themselves, and only when asked.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use crate::doc::Doc;

/// The branch for `path`, then every branch it merges through, nearest first
/// and ending at `main`.
pub fn chain(root: &Path, path: &Path) -> Result<Vec<String>> {
	let docs = crate::load(root)?;
	let by_path: BTreeMap<&Path, &Doc> = docs.iter().map(|d| (d.path.as_path(), d)).collect();
	let mut cur = crate::ready::locate(root, path, &by_path)?;
	let mut out = Vec::new();
	while !Doc::permanent(&cur) {
		out.push(cur.with_extension("").display().to_string());
		cur = Doc::owner(&cur).join("README.md");
	}
	if out.is_empty() {
		bail!("{} is the root or a milestone, which has no branch", path.display());
	}
	out.push("main".to_string());
	Ok(out)
}

/// The tree as the line branches on `remote` see it.
///
/// A line's children merge into its branch, not `main`, so until the line lands
/// the working tree still lists quests that are already done. Each line whose
/// branch exists replaces its directory with that branch's copy, outermost
/// first, so a nested line's own branch has the last word on its subtree. A
/// line that an outer branch already completed stays gone even if its own
/// branch lingers.
pub(crate) fn overlay(root: &Path, docs: Vec<Doc>, remote: &str) -> Result<Vec<Doc>> {
	// Fail on a typo'd remote or a tree outside git, rather than read every line
	// as absent and report the working tree as if it were the answer.
	git(root, &["remote", "get-url", remote])?;

	let mut docs: BTreeMap<PathBuf, Doc> = docs.into_iter().map(|d| (d.path.clone(), d)).collect();
	let mut lines: Vec<PathBuf> = docs.keys().filter(|p| is_line(p)).cloned().collect();
	lines.sort_by_key(|p| p.components().count());
	let mut pending = VecDeque::from(lines);
	let mut seen = BTreeSet::new();

	while let Some(readme) = pending.pop_front() {
		if !docs.contains_key(&readme) || !seen.insert(readme.clone()) {
			continue;
		}
		let rev = format!("refs/remotes/{remote}/{}", readme.with_extension("").display());
		// A line nobody has started has no branch yet.
		if git(
			root,
			&["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")],
		)
		.is_err()
		{
			continue;
		}

		let dir = readme.parent().unwrap_or(Path::new(""));
		docs.retain(|path, _| !path.starts_with(dir));
		let listing = git(
			root,
			&[
				"ls-tree",
				"-r",
				"-z",
				"--name-only",
				&rev,
				"--",
				&format!("{}/", dir.display()),
			],
		)?;
		for path in listing.split('\0').filter(|p| !p.is_empty()).map(PathBuf::from) {
			if !crate::is_quest(&path) {
				continue;
			}
			let text = git(root, &["show", &format!("{rev}:./{}", path.display())])?;
			if is_line(&path) {
				pending.push_back(path.clone());
			}
			docs.insert(path.clone(), Doc::from_str(path, &text));
		}
	}
	Ok(docs.into_values().collect())
}

/// A README with a branch: anything but the root and the milestones.
fn is_line(path: &Path) -> bool {
	path.file_name().is_some_and(|n| n == "README.md") && !Doc::permanent(path)
}

/// Run git in `root`, returning stdout; a failure is an error carrying stderr.
fn git(root: &Path, args: &[&str]) -> Result<String> {
	let out = Command::new("git")
		.arg("-C")
		.arg(root)
		.args(args)
		.output()
		.context("running git")?;
	if !out.status.success() {
		bail!(
			"git {} failed: {}",
			args.join(" "),
			String::from_utf8_lossy(&out.stderr).trim()
		);
	}
	String::from_utf8(out.stdout).context("git printed non-UTF-8")
}
