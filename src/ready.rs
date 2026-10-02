//! Whether a quest can be started, read from the same `Required` and `Claim` sections the
//! rules validate.
//!
//! Readiness is a property of the tree alone, which is what makes it cheap and
//! deterministic: a finished quest is deleted, so a blocker that still resolves
//! is still open. Liveness is the other question - a quest can be ready,
//! coherent, and already done by some other PR - and answering it means asking
//! GitHub, so it belongs to the flow that is already talking to it.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

use crate::doc::Doc;
use crate::rules;

/// One thing standing between a quest and being started.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Blocker {
	/// The quest or questline that has to finish first. `None` is an entry that
	/// is not a quest, which `quest check` rejects and nothing here can clear.
	pub path: Option<PathBuf>,
	/// The dependency or claim as written, whitespace collapsed.
	pub text: String,
	/// The still-open quests under a required questline, which is what a
	/// questline blocker actually means. Empty for every other blocker: a
	/// required quest's own blockers are its readiness, not this one's.
	pub blockers: Vec<Blocker>,
}

impl Blocker {
	/// What names the blocker: the document, or the entry's own words.
	pub fn label(&self) -> String {
		match &self.path {
			Some(path) => path.display().to_string(),
			None => self.text.clone(),
		}
	}

	fn write(&self, f: &mut fmt::Formatter<'_>, depth: usize) -> fmt::Result {
		writeln!(f, "{}{}", "  ".repeat(depth), self.label())?;
		for blocker in &self.blockers {
			blocker.write(f, depth + 1)?;
		}
		Ok(())
	}
}

impl fmt::Display for Blocker {
	/// The whole chain, one blocker per line and indented by depth, newline
	/// included: a caller prints these back to back.
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		self.write(f, 0)
	}
}

/// What blocks `path`, a required questline expanded into the quests it still
/// holds. Empty means ready.
///
/// `path` is the quest as the tree writes it (`/quest/m0/one.md`), as the shell
/// completes it (`quest/m0/one.md`), or as an absolute filesystem path. With a
/// `remote`, each line is read from its branch there; see [`crate::branch::overlay`].
#[cfg(not(target_arch = "wasm32"))]
pub fn blockers(root: &Path, path: &Path, remote: Option<&str>) -> Result<Vec<Blocker>> {
	let docs = crate::load_from(root, remote)?;
	let by_path: BTreeMap<&Path, &Doc> = docs.iter().map(|d| (d.path.as_path(), d)).collect();
	let path = locate(root, path, &by_path)?;
	Ok(expand(&by_path, by_path[path.as_path()], &mut vec![path.clone()]))
}

/// Blockers in an already-loaded tree. Paths are repository-relative or
/// root-absolute (`/quest/...`); filesystem absolute paths belong to the CLI.
pub fn blockers_from(docs: &[Doc], path: &Path) -> Result<Vec<Blocker>> {
	let by_path: BTreeMap<&Path, &Doc> = docs.iter().map(|doc| (doc.path.as_path(), doc)).collect();
	let path = locate_in_docs(path, &by_path)?;
	Ok(expand(&by_path, by_path[path.as_path()], &mut vec![path.clone()]))
}

/// Every quest that can be started now, in tree order.
///
/// A questline is not listed while it still requires children; a README with
/// none left is the line's own remaining work and lists like any other quest.
/// A quest is ready when it has neither a `## Required` nor a `## Claim` heading.
/// `remote` is as for [`blockers`].
#[cfg(not(target_arch = "wasm32"))]
pub fn quests(root: &Path, remote: Option<&str>) -> Result<Vec<PathBuf>> {
	let docs = crate::load_from(root, remote)?;
	Ok(quests_from(&docs))
}

/// Every ready quest from already-loaded documents, without IO or git.
pub fn quests_from(docs: &[Doc]) -> Vec<PathBuf> {
	let mut remaining: BTreeMap<PathBuf, &Doc> = docs.iter().map(|doc| (doc.path.clone(), doc)).collect();
	let mut pending = vec![PathBuf::from("quest/README.md")];
	let mut ready = Vec::new();
	while let Some(path) = pending.pop() {
		let Some(doc) = remaining.remove(&path) else { continue };
		if doc.is_questline() {
			let children: Vec<_> = doc.children().collect();
			pending.extend(children.into_iter().rev());
		} else if !doc.has("Required") && !doc.has("Claim") {
			ready.push(path);
		}
	}
	ready.extend(
		remaining
			.into_iter()
			.filter(|(_, doc)| !doc.is_questline() && !doc.has("Required") && !doc.has("Claim"))
			.map(|(path, _)| path),
	);
	ready
}

/// The blockers of one document: its `Required` entries, which for a questline
/// include its children.
fn expand(by_path: &BTreeMap<&Path, &Doc>, doc: &Doc, stack: &mut Vec<PathBuf>) -> Vec<Blocker> {
	let mut blockers = Vec::new();
	if doc.has("Claim") {
		blockers.push(Blocker {
			path: None,
			text: match doc.entries("Claim").next() {
				Some(entry) => format!("claimed by {}", entry.text),
				None => "an empty '## Claim' section, which blocks the quest until the heading is removed".to_string(),
			},
			blockers: Vec::new(),
		});
	}
	// A heading left standing after its last blocker still reads as blocked to
	// everything that greps for it, including `quest check`, which reports it.
	// Calling it ready here would make this the one tool that disagrees.
	if doc.has("Required") && doc.entries("Required").next().is_none() {
		blockers.push(Blocker {
			path: None,
			text: "an empty '## Required' section, which blocks the quest until the heading is removed".to_string(),
			blockers: Vec::new(),
		});
	}

	blockers.extend(doc.entries("Required").map(|entry| blocker(by_path, entry, stack)));
	blockers
}

fn blocker(by_path: &BTreeMap<&Path, &Doc>, entry: &crate::doc::Entry, stack: &mut Vec<PathBuf>) -> Blocker {
	// A bullet that does not open with a link into the tree is invalid, and
	// nothing here can clear it, so it is a blocker with nothing under it.
	let path = entry
		.target
		.as_deref()
		.and_then(rules::rooted)
		.filter(|path| by_path.contains_key(path.as_path()));

	// Only a questline expands. A required QUEST is the blocker itself, and its
	// own chain is the answer to running this on that quest instead; printing
	// it here buries the entries that were asked for under a repeated subtree.
	// The stack guard is for a tree nobody has run `quest check` on yet, where a
	// questline listing an ancestor must print rather than recurse forever.
	let blockers = match &path {
		Some(path) if by_path[path.as_path()].is_questline() && !stack.contains(path) => {
			stack.push(path.clone());
			let blockers = expand(by_path, by_path[path.as_path()], stack);
			stack.pop();
			blockers
		}
		_ => Vec::new(),
	};

	Blocker {
		path,
		text: entry.text.clone(),
		blockers,
	}
}

/// Resolve a quest path the way a caller is likely to have it to the
/// repository-relative one the tree is keyed on.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn locate(root: &Path, path: &Path, by_path: &BTreeMap<&Path, &Doc>) -> Result<PathBuf> {
	let mut candidates = vec![rules::normalize(path)];
	if let Some(rooted) = path.to_str().and_then(|p| p.strip_prefix('/')) {
		candidates.push(rules::normalize(Path::new(rooted)));
	}
	if let (Ok(absolute), Ok(root)) = (path.canonicalize(), root.canonicalize())
		&& let Ok(relative) = absolute.strip_prefix(root)
	{
		candidates.push(relative.to_path_buf());
	}

	for candidate in candidates {
		if let Ok(found) = locate_in_docs(&candidate, by_path) {
			return Ok(found);
		}
	}
	bail!(
		"{} is not a quest document under {}",
		path.display(),
		root.join("quest").display()
	)
}

fn locate_in_docs(path: &Path, by_path: &BTreeMap<&Path, &Doc>) -> Result<PathBuf> {
	let path = path
		.to_str()
		.and_then(|path| path.strip_prefix('/'))
		.map(Path::new)
		.unwrap_or(path);
	let path = rules::normalize(path);
	if by_path.contains_key(path.as_path()) {
		Ok(path)
	} else {
		bail!("{} is not a quest document", path.display())
	}
}
