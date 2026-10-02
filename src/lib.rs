//! The quest tree, whose contract is the guide in [`skills::GUIDE`]: structural
//! validation of it, whether a given quest can be started, which branches carry
//! it, and the agent skills that work it.
//!
//! The whole tree is validated on every run, never just the changed files: the
//! link graph and the questline index are global, so completing one quest
//! breaks files the diff never mentions. That is not hypothetical - it is how
//! the index entry for a completed quest survived a rebase that produced no
//! conflict at all.

#[cfg(not(target_arch = "wasm32"))]
pub mod branch;
pub mod doc;
pub mod ready;
pub mod rules;
#[cfg(not(target_arch = "wasm32"))]
pub mod setup;
pub mod skills;

pub use doc::Doc;
pub use ready::Blocker;
pub use rules::Finding;

/// Agent instructions are not quests, including the quest/AGENTS.md older
/// versions installed and CLAUDE.md files in adopting repositories. Neither
/// filename is indexed or validated.
const NOT_QUESTS: [&str; 2] = ["AGENTS.md", "CLAUDE.md"];

pub mod claim;
pub mod tree;

#[cfg(not(target_arch = "wasm32"))]
mod native;
#[cfg(not(target_arch = "wasm32"))]
pub use native::{check, collect};
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use native::{load, load_from};

#[cfg(target_arch = "wasm32")]
mod wasm;

/// A Markdown file other than agent instructions.
pub(crate) fn is_quest(path: &std::path::Path) -> bool {
	path.extension().is_some_and(|e| e == "md")
		&& !path
			.file_name()
			.is_some_and(|n| NOT_QUESTS.iter().any(|skip| n == *skip))
}
