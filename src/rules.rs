//! The rules, and the findings they produce.
//!
//! The contract is the guide (`quest guide`). Every rule here is one that has already
//! been broken by hand, and the expensive failure is a rule that stops firing:
//! a validator that quietly enforces nothing looks exactly like a clean tree.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::doc::{Doc, Position};

/// The `## ` headings a quest document may use. Readiness greps `## Required`
/// literally, so a typo turns a blocked quest ready and fails nowhere else:
/// the closed vocabulary is what catches it.
const HEADINGS: [&str; 6] = ["Goal", "Plan", "Claim", "Required", "Closes", "Related"];
const SIZES: [&str; 5] = ["XS", "S", "M", "L", "XL"];

/// Sections whose whole content is a list. A heading left standing after its
/// last entry was removed is a bug: an empty `Required` blocks its quest
/// forever.
const LIST_SECTIONS: [&str; 3] = ["Required", "Closes", "Related"];

/// The permanent root questline; the one document nothing has to list.
pub const ROOT: &str = "quest/README.md";

/// One violation, addressed like a compiler diagnostic: `path:line: message`.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub struct Finding {
	/// Repository-relative document the violation is in.
	pub path: PathBuf,
	/// 1-based line, when the violation has one; `None` for whole-file findings.
	pub line: Option<usize>,
	/// What is wrong, and often why the rule exists.
	pub message: String,
}

impl std::fmt::Display for Finding {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self.line {
			Some(line) => write!(f, "{}:{}: {}", self.path.display(), line, self.message),
			None => write!(f, "{}: {}", self.path.display(), self.message),
		}
	}
}

struct Findings(Vec<Finding>);

impl Findings {
	fn at(&mut self, path: &Path, line: usize, message: impl Into<String>) {
		self.0.push(Finding {
			path: path.to_path_buf(),
			line: Some(line),
			message: message.into(),
		});
	}

	fn on(&mut self, path: &Path, message: impl Into<String>) {
		self.0.push(Finding {
			path: path.to_path_buf(),
			line: None,
			message: message.into(),
		});
	}
}

/// `root` is the repository root; every path in `docs` is relative to it.
pub fn check(docs: &[Doc], exists: impl Fn(&Path) -> bool) -> Vec<Finding> {
	let mut found = Findings(Vec::new());
	let known: BTreeSet<&Path> = docs.iter().map(|d| d.path.as_path()).collect();

	for doc in docs {
		headings(&mut found, doc);
		claim(&mut found, doc);
		links(&mut found, &exists, &known, doc);
	}

	index(&mut found, &known, docs);
	cycles(&mut found, docs);

	found.0.sort();
	found.0
}

/// Claims use a small, forge-independent envelope. The location and any
/// trailing fields are opaque; neither forge policy nor expiry belongs here.
fn claim(found: &mut Findings, doc: &Doc) {
	let headings: Vec<_> = doc.headings.iter().filter(|heading| heading.text == "Claim").collect();
	if headings.is_empty() {
		return;
	}
	let entries: Vec<_> = doc.entries("Claim").collect();
	if headings.len() != 1 || entries.len() != 1 || doc.claim_extra_content {
		found.at(
			&doc.path,
			headings[0].line,
			"'## Claim' must contain exactly one list item in one section",
		);
		return;
	}
	if crate::claim::Claim::parse(&entries[0].text).is_none() {
		found.at(
			&doc.path,
			entries[0].line,
			"claim must name a claimant, (provider:identity), fork or branch, and date: Name (provider:identity) on location since YYYY-MM-DD",
		);
	}
}

fn headings(found: &mut Findings, doc: &Doc) {
	if !doc.is_questline() {
		let valid = doc.title.as_ref().is_some_and(|title| {
			let Some((size, name)) = title.text.strip_prefix('[').and_then(|s| s.split_once("] ")) else {
				return false;
			};
			title.literal && SIZES.contains(&size) && !name.is_empty()
		});
		if !valid {
			found.on(&doc.path, "quest title must be '# [XS|S|M|L|XL] Title'");
		}
	}

	if !doc.has("Goal") {
		found.on(&doc.path, "missing '## Goal'");
	}

	for heading in &doc.headings {
		// A setext underline and a decorated ``## `Required` `` both render as
		// the same heading, and this validator would treat the quest as blocked.
		// Readiness greps `^## Required$` literally and would call it READY.
		if HEADINGS.contains(&heading.text.as_str()) && !heading.literal {
			found.at(
				&doc.path,
				heading.line,
				format!(
					"'{}' must be written literally as '## {}'; readiness greps that form and would not see this one",
					heading.text, heading.text
				),
			);
		}
		if !HEADINGS.contains(&heading.text.as_str()) {
			found.at(
				&doc.path,
				heading.line,
				format!("unknown '## {}' (allowed: {})", heading.text, HEADINGS.join(", ")),
			);
		}
	}

	for heading in &doc.headings {
		if LIST_SECTIONS.contains(&heading.text.as_str()) && doc.entries(&heading.text).next().is_none() {
			let why = match heading.text.as_str() {
				"Required" => "; an empty one blocks the quest forever, so remove the heading with its last entry",
				_ => "; remove the heading with its last entry",
			};
			found.at(&doc.path, heading.line, format!("'## {}' is empty{why}", heading.text));
		}
	}
}

/// Strip a `#fragment`, which addresses a place inside a file rather than a
/// different file. Leaving it on made a phantom graph node that no quest could
/// ever match, so a cycle through an anchored link went unreported.
fn without_fragment(target: &str) -> &str {
	target.split('#').next().unwrap_or(target)
}

/// A root-absolute target as a repository-relative path, or `None` if it is not
/// root-absolute. Fragment-stripped AND normalized: the index and the cycle walk
/// both key on this, and a `..` left in one of them is a node nothing matches.
pub(crate) fn rooted(target: &str) -> Option<PathBuf> {
	target
		.strip_prefix('/')
		.map(|r| normalize(Path::new(without_fragment(r))))
}

fn resolve(doc_path: &Path, target: &str) -> PathBuf {
	match target.strip_prefix('/') {
		Some(rooted) => normalize(Path::new(rooted)),
		None => normalize(&doc_path.parent().unwrap_or(Path::new("")).join(target)),
	}
}

/// Collapse `..` textually. `Path::canonicalize` would need the file to exist,
/// which is the very thing being tested.
pub(crate) fn normalize(path: &Path) -> PathBuf {
	let mut out = PathBuf::new();
	for part in path.components() {
		match part {
			std::path::Component::ParentDir => {
				// Popping unconditionally let `../..` cancel itself, so a link
				// with too many `..` climbed above the root and then walked back
				// down to a real file.
				if out.components().next_back() == Some(std::path::Component::ParentDir) || !out.pop() {
					out.push("..");
				}
			}
			std::path::Component::CurDir => {}
			other => out.push(other.as_os_str()),
		}
	}
	out
}

fn links(found: &mut Findings, exists: &impl Fn(&Path) -> bool, known: &BTreeSet<&Path>, doc: &Doc) {
	for link in &doc.links {
		if link.target.contains("://") || link.target.starts_with("mailto:") {
			continue;
		}
		let target = without_fragment(&link.target);
		if target.is_empty() {
			continue;
		}

		// A normalized path that still opens with `..` points above the
		// repository root. Joining it to `root` and testing existence would
		// follow it into whatever sits beside the checkout, so the repo's own
		// directory name (or a sibling worktree) could make a broken link pass.
		let path = resolve(&doc.path, target);
		if path.starts_with("..") || !exists(&path) {
			found.at(&doc.path, link.line, format!("link does not resolve: {}", link.target));
			continue;
		}

		// Quests and questlines reference each other with root-absolute links.
		// A relative one still renders, so nothing else would notice - but it is
		// invisible to the dependency graph below, which only speaks /quest/...
		if known.contains(path.as_path()) && !link.target.starts_with('/') {
			found.at(
				&doc.path,
				link.line,
				format!(
					"link to a quest must be root-absolute: {} (write /{})",
					link.target,
					path.display()
				),
			);
		}

		// A `Required` entry opens with its quest link. moq-dev/moq.pro#1170
		// shipped a customer-gate sentence mentioning a questline mid-line,
		// which reads as context but IS a blocker, and so silently required all
		// of m2.
		if link.section.as_deref() == Some("Required")
			&& known.contains(path.as_path())
			&& link.position != Position::Entry
		{
			found.at(
				&doc.path,
				link.line,
				format!(
					"Required links {} mid-sentence; that reads as prose but IS a blocker - open the bullet with the link, or drop the link",
					link.target
				),
			);
		}
	}
}

/// Every document is listed by the questline it sits under, as a child in that
/// README's `Required`, and every `Required` entry is a quest, required once.
///
/// A condition outside the repository (a release, a customer, a person) is a
/// quest of its own rather than a plain-text bullet: a blocked quest drops out
/// of every ready listing, so the condition would be forgotten, while its own
/// quest keeps surfacing as ready until someone clears it.
fn index(found: &mut Findings, known: &BTreeSet<&Path>, docs: &[Doc]) {
	let mut listed: BTreeSet<PathBuf> = BTreeSet::new();

	for doc in docs {
		listed.extend(doc.children());

		let mut seen = BTreeSet::new();
		for entry in doc.entries("Required") {
			let target = entry.target.as_deref().and_then(rooted);
			let Some(target) = target.filter(|t| known.contains(t.as_path())) else {
				found.at(
					&doc.path,
					entry.line,
					format!(
						"requires {}, which is not a quest document; make an outside condition its own quest",
						entry.target.as_deref().unwrap_or(&entry.text)
					),
				);
				continue;
			};
			if !seen.insert(target) {
				found.at(
					&doc.path,
					entry.line,
					format!("requires {} twice", entry.target.as_deref().unwrap_or_default()),
				);
			}
		}
	}

	for doc in docs {
		// The root questline is permanent and has nothing above it to list it.
		if doc.path == Path::new(ROOT) || listed.contains(&doc.path) {
			continue;
		}
		let owner = Doc::owner(&doc.path).join("README.md");
		found.on(
			&doc.path,
			format!(
				"not listed in {}'s '## Required'; an unlisted quest is unreachable",
				owner.display()
			),
		);
	}
}

/// `Required` must be acyclic. A cycle is a set of quests none of which can
/// ever start, and walking the links to rule one out is exactly the manual step
/// an author would otherwise take before adding a blocker. A questline requires
/// its children, so a quest requiring the line that holds it is a cycle too.
fn cycles(found: &mut Findings, docs: &[Doc]) {
	let mut blockers: BTreeMap<&Path, Vec<PathBuf>> = BTreeMap::new();

	for doc in docs {
		let edges: Vec<PathBuf> = doc
			.links
			.iter()
			.filter(|l| l.section.as_deref() == Some("Required") && l.position == Position::Entry)
			.filter_map(|l| rooted(&l.target))
			.collect();
		blockers.entry(doc.path.as_path()).or_default().extend(edges);
	}

	#[derive(Clone, Copy, PartialEq)]
	enum State {
		Open,
		Done,
	}

	fn walk(
		node: &Path,
		blockers: &BTreeMap<&Path, Vec<PathBuf>>,
		state: &mut BTreeMap<PathBuf, State>,
		stack: &mut Vec<PathBuf>,
		found: &mut Findings,
	) {
		match state.get(node) {
			Some(State::Done) => return,
			Some(State::Open) => {
				let from = stack.iter().position(|p| p == node).unwrap_or(0);
				let mut path: Vec<String> = stack[from..].iter().map(|p| p.display().to_string()).collect();
				path.push(node.display().to_string());
				found.on(node, format!("Required cycle: {}", path.join(" -> ")));
				return;
			}
			None => {}
		}
		state.insert(node.to_path_buf(), State::Open);
		stack.push(node.to_path_buf());
		for next in blockers.get(node).map(Vec::as_slice).unwrap_or_default() {
			walk(next, blockers, state, stack, found);
		}
		stack.pop();
		state.insert(node.to_path_buf(), State::Done);
	}

	let mut state = BTreeMap::new();
	for doc in docs {
		walk(&doc.path, &blockers, &mut state, &mut Vec::new(), found);
	}
}
