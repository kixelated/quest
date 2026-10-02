//! Quest branches target one shared trunk: the remote's default branch.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

use crate::doc::Doc;

/// The quest branch and the default branch it targets, including a README's
/// remaining work. Roots and milestones never have their own branch.
pub fn chain(root: &Path, path: &Path, remote: &str) -> Result<Vec<String>> {
	let base = default(root, remote)?;
	let docs = read(root, remote, &base)?;
	let by_path: BTreeMap<&Path, &Doc> = docs.iter().map(|d| (d.path.as_path(), d)).collect();
	let path = crate::ready::locate(root, path, &by_path)?;
	if Doc::permanent(&path) {
		bail!("{} is the root or a milestone, which has no branch", path.display());
	}
	Ok(vec![path.with_extension("").display().to_string(), base])
}

/// Resolve the cached remote default. Never guess a branch name or contact the
/// network; callers fetch and refresh the remote's HEAD before starting work.
fn default(root: &Path, remote: &str) -> Result<String> {
	git(root, &["remote", "get-url", remote])?;
	let prefix = format!("refs/remotes/{remote}/");
	let head = git(root, &["symbolic-ref", &format!("{prefix}HEAD")]).with_context(|| {
		format!("refresh the default branch with `git remote set-head {remote} --auto` after fetching")
	})?;
	let branch = head
		.trim()
		.strip_prefix(&prefix)
		.filter(|b| !b.is_empty() && *b != "HEAD")
		.context("remote HEAD must point to a branch on the same remote")?;
	Ok(branch.to_string())
}

/// Read the whole tree at the fetched default branch. Local edits and old
/// questline branches cannot override completed work on the trunk.
pub(crate) fn tree(root: &Path, remote: &str) -> Result<Vec<Doc>> {
	read(root, remote, &default(root, remote)?)
}

fn read(root: &Path, remote: &str, base: &str) -> Result<Vec<Doc>> {
	// Pin one commit so concurrent fetches cannot mix two versions of the tree.
	let rev = git(
		root,
		&[
			"rev-parse",
			"--verify",
			&format!("refs/remotes/{remote}/{base}^{{commit}}"),
		],
	)?;
	let rev = rev.trim();
	let listing = git(root, &["ls-tree", "-r", "-z", "--name-only", rev, "--", "quest/"])?;
	let mut docs = Vec::new();
	for path in listing
		.split('\0')
		.filter(|p| !p.is_empty())
		.map(std::path::PathBuf::from)
	{
		if !crate::is_quest(&path) {
			continue;
		}
		let text = git(root, &["show", &format!("{rev}:./{}", path.display())])?;
		docs.push(Doc::from_str(path, &text));
	}
	if docs.is_empty() {
		bail!("no quest documents found on {remote}/{base}");
	}
	Ok(docs)
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
