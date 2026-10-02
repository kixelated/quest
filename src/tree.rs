//! Pure evaluation of a complete, already-loaded repository snapshot.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::{Blocker, Doc, Finding, claim::Claim, ready, rules};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Document {
	pub path: String,
	pub content: String,
}

/// All Markdown bodies and an explicit inventory of existing repository paths.
/// Native callers can instead give `Tree::check` a live existence callback.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Snapshot {
	pub documents: Vec<Document>,
	pub paths: Vec<String>,
}

pub struct Tree {
	pub docs: Vec<Doc>,
}

impl Tree {
	pub fn from_files(documents: &[Document]) -> Result<Self> {
		let mut docs = BTreeMap::new();
		let mut seen = BTreeSet::new();
		for document in documents {
			let path = relative(&document.path)?;
			if !seen.insert(path.clone()) {
				bail!("duplicate document: {}", path.display());
			}
			if path.starts_with("quest") && crate::is_quest(&path) {
				docs.insert(path.clone(), Doc::from_str(path, &document.content));
			}
		}
		if docs.is_empty() {
			bail!("no quest documents found under quest");
		}
		Ok(Self {
			docs: docs.into_values().collect(),
		})
	}

	pub fn check(&self, exists: impl Fn(&Path) -> bool) -> Vec<Finding> {
		rules::check(&self.docs, exists)
	}

	pub fn ready(&self) -> Vec<PathBuf> {
		ready::quests_from(&self.docs)
	}

	pub fn blockers(&self, path: &Path) -> Result<Vec<Blocker>> {
		ready::blockers_from(&self.docs, path)
	}
}

#[derive(Debug, Serialize)]
pub struct Evaluation {
	pub findings: Vec<Finding>,
	pub ready: Vec<PathBuf>,
	pub blockers: Option<Vec<Blocker>>,
	pub claims: BTreeMap<PathBuf, Claim>,
}

pub fn evaluate(snapshot: &Snapshot, path: Option<&Path>) -> Result<Evaluation> {
	let paths: BTreeSet<_> = snapshot
		.paths
		.iter()
		.map(|path| relative(path))
		.collect::<Result<_>>()?;
	for document in &snapshot.documents {
		if !paths.contains(Path::new(&document.path)) {
			bail!("document absent from path inventory: {}", document.path);
		}
	}
	let tree = Tree::from_files(&snapshot.documents)?;
	Ok(Evaluation {
		findings: tree.check(|path| path.as_os_str().is_empty() || paths.contains(path)),
		ready: tree.ready(),
		blockers: path.map(|path| tree.blockers(path)).transpose()?,
		claims: tree
			.docs
			.iter()
			.filter_map(|doc| doc.claim().map(|claim| (doc.path.clone(), claim)))
			.collect(),
	})
}

/// Snapshot paths are canonical repository-relative paths. Root-absolute links
/// are normalized by the rules, never by silently rewriting snapshot keys.
fn relative(path: &str) -> Result<PathBuf> {
	let parsed = Path::new(path);
	if path.is_empty()
		|| parsed.is_absolute()
		|| parsed.components().any(|part| !matches!(part, Component::Normal(_)))
		|| rules::normalize(parsed).to_str() != Some(path)
	{
		bail!("invalid repository path: {path}");
	}
	Ok(parsed.to_path_buf())
}
