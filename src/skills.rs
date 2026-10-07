//! The agent skills and the quest guide, compiled into the binary.
//!
//! A repository installs only a stub per skill, which asks the agent to run
//! `quest skill <name>`. The stub never changes between versions, so the
//! version a repository pins decides which instructions its agents follow and
//! upgrading never rewrites repository files.

/// The quest contract: the format, workflow, and rules every skill builds on.
pub const GUIDE: &str = include_str!("../assets/AGENTS.md");

/// Every skill, sorted by name.
const SKILLS: [(&str, &str); 10] = [
	("audit", include_str!("../assets/skills/audit.md")),
	("complete", include_str!("../assets/skills/complete.md")),
	("delete", include_str!("../assets/skills/delete.md")),
	("export", include_str!("../assets/skills/export.md")),
	("import", include_str!("../assets/skills/import.md")),
	("iterate", include_str!("../assets/skills/iterate.md")),
	("merge", include_str!("../assets/skills/merge.md")),
	("plan", include_str!("../assets/skills/plan.md")),
	("spawn", include_str!("../assets/skills/spawn.md")),
	("start", include_str!("../assets/skills/start.md")),
];

/// Where an agent without the binary learns to install it.
const SETUP: &str = "https://github.com/kixelated/quest/blob/main/SETUP.md";

/// Installed skills carry this prefix so they don't collide with a
/// repository's own.
const PREFIX: &str = "quest-";

/// One skill: YAML frontmatter, then the instructions.
#[derive(Clone, Copy, Debug)]
pub struct Skill {
	/// The name `quest skill <name>` takes.
	pub name: &'static str,
	text: &'static str,
}

impl Skill {
	/// The frontmatter, fences excluded.
	fn frontmatter(&self) -> &'static str {
		self.split().0
	}

	/// The instructions `quest skill <name>` prints.
	pub fn body(&self) -> &'static str {
		self.split().1
	}

	/// The one-line summary agents match a request against.
	pub fn description(&self) -> &'static str {
		self.frontmatter()
			.lines()
			.find_map(|line| line.strip_prefix("description: "))
			.unwrap_or("")
	}

	/// The name an agent invokes it by, which is also its installed directory.
	pub fn installed(&self) -> String {
		format!("{PREFIX}{}", self.name)
	}

	/// The `SKILL.md` a repository installs: the frontmatter, and a pointer
	/// back to this binary for everything else.
	pub fn stub(&self) -> String {
		format!(
			"---\nname: {}\n{}\n---\n\nRun `quest skill {}` and follow its output.\nIf `quest` is not installed, follow {SETUP} first.\n",
			self.installed(),
			self.frontmatter(),
			self.name,
		)
	}

	fn split(&self) -> (&'static str, &'static str) {
		self.text
			.strip_prefix("---\n")
			.and_then(|rest| rest.split_once("\n---\n"))
			.map(|(front, body)| (front, body.trim_start_matches('\n')))
			.expect("every embedded skill opens with frontmatter")
	}
}

/// Every skill, sorted by name.
pub fn all() -> impl Iterator<Item = Skill> {
	SKILLS.iter().map(|&(name, text)| Skill { name, text })
}

/// The skill called `name`, if this version ships one.
pub fn get(name: &str) -> Option<Skill> {
	all().find(|skill| skill.name == name)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The stub writes the installed name, so a `name:` in the source would
	/// install under one name and trigger as another.
	#[test]
	fn frontmatter_is_complete() {
		for skill in all() {
			assert!(
				!skill.frontmatter().lines().any(|line| line.starts_with("name:")),
				"{} frontmatter names itself",
				skill.name
			);
			assert!(!skill.description().is_empty(), "{} description", skill.name);
			// The stub copies the description as a plain YAML scalar, where ": " is invalid.
			assert!(
				!skill.description().contains(": "),
				"{} description has \": \"",
				skill.name
			);
			assert!(!skill.body().trim().is_empty(), "{} body", skill.name);
		}
	}

	#[test]
	fn sorted_and_unique() {
		let names: Vec<_> = all().map(|skill| skill.name).collect();
		let mut sorted = names.clone();
		sorted.sort();
		sorted.dedup();
		assert_eq!(names, sorted);
	}

	/// The contract is no longer a file an adopter has, so a skill pointing at
	/// one sends the agent looking for nothing.
	#[test]
	fn skills_point_at_the_guide() {
		for skill in all() {
			assert!(!skill.body().contains("AGENTS.md"), "{} mentions AGENTS.md", skill.name);
		}
	}

	/// This repository installs the same stubs as everyone else, so a skill
	/// added or renamed here without its stub fails rather than going unused.
	#[test]
	fn repository_stubs_are_current() {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".claude/skills");
		let mut installed: Vec<String> = std::fs::read_dir(&dir)
			.expect("read .claude/skills")
			.map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
			.collect();
		installed.sort();
		assert_eq!(installed, all().map(|skill| skill.installed()).collect::<Vec<_>>());
		for skill in all() {
			let stub = std::fs::read_to_string(dir.join(skill.installed()).join("SKILL.md")).expect("read stub");
			assert_eq!(
				stub,
				skill.stub(),
				"{} stub is stale; regenerate it with `quest skill --stub`",
				skill.name
			);
		}
	}
}
