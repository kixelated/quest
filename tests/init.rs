//! Integration tests for `quest init` and `quest uninstall` in temporary repositories.

use std::path::Path;

use tempfile::TempDir;

fn repo() -> TempDir {
	TempDir::new().expect("tempdir")
}

fn init(root: &Path) -> Vec<std::path::PathBuf> {
	quest::setup::init(root).expect("init")
}

fn uninstall(root: &Path) -> Vec<std::path::PathBuf> {
	quest::setup::uninstall(root).expect("uninstall")
}

#[test]
fn init_creates_layout_and_is_idempotent() {
	let dir = repo();
	let first = init(dir.path());
	assert!(!first.is_empty());
	assert!(dir.path().join(".claude/skills/quest-start/SKILL.md").is_file());
	assert!(dir.path().join(".agents/skills/quest-start/SKILL.md").is_file());
	assert!(dir.path().join("quest/README.md").is_file());
	assert!(dir.path().join(".gitignore").is_file());
	assert!(dir.path().join("AGENTS.md").is_file());
	let ignore = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
	assert!(ignore.lines().any(|line| line == "/.scratch/"));
	let agents = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();
	assert!(agents.contains(quest::setup::REFERENCE_LINE));

	let second = init(dir.path());
	assert!(second.is_empty(), "second init changed: {second:?}");
}

#[test]
fn init_refuses_non_stub_skill() {
	let dir = repo();
	let skill_dir = dir.path().join(".claude/skills/quest-start");
	std::fs::create_dir_all(&skill_dir).unwrap();
	std::fs::write(skill_dir.join("SKILL.md"), "# My workflow\n").unwrap();
	let err = quest::setup::init(dir.path()).unwrap_err();
	assert!(err.to_string().contains("not a Quest stub"));
}

#[test]
fn init_appends_agents_not_claude_when_both_exist() {
	let dir = repo();
	std::fs::write(dir.path().join("AGENTS.md"), "# Repo\n\nKeep this.\n").unwrap();
	std::fs::write(dir.path().join("CLAUDE.md"), "# Claude only\n").unwrap();
	init(dir.path());
	let agents = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();
	let claude = std::fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
	assert!(agents.contains("Keep this."));
	assert!(agents.contains(quest::setup::REFERENCE_LINE));
	assert!(!claude.contains(quest::setup::REFERENCE_LINE));
}

#[test]
fn init_uses_claude_when_only_claude_exists() {
	let dir = repo();
	std::fs::write(dir.path().join("CLAUDE.md"), "# Claude\n").unwrap();
	init(dir.path());
	let claude = std::fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
	assert!(claude.contains(quest::setup::REFERENCE_LINE));
	assert!(!dir.path().join("AGENTS.md").exists());
}

#[test]
fn uninstall_round_trip_preserves_user_content() {
	let dir = repo();
	std::fs::write(dir.path().join("AGENTS.md"), "# Repo\n\nUser rule.\n").unwrap();
	std::fs::create_dir_all(dir.path().join("quest/m0")).unwrap();
	std::fs::write(dir.path().join("quest/m0/plan.md"), "# [S] Keep\n\n## Goal\n\nStay.\n").unwrap();
	init(dir.path());
	uninstall(dir.path());

	let agents = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();
	assert_eq!(agents, "# Repo\n\nUser rule.\n");
	assert!(dir.path().join("quest/m0/plan.md").is_file());
	assert!(!dir.path().join(".gitignore").exists());
	assert!(!dir.path().join(".claude").exists());
	assert!(!dir.path().join(".agents").exists());
}

#[test]
fn round_trip_with_codex_skills_directory() {
	let dir = repo();
	std::fs::create_dir_all(dir.path().join(".agents/skills")).unwrap();
	init(dir.path());
	assert!(dir.path().join(".agents/skills/quest-start/SKILL.md").is_file());
	assert!(dir.path().join(".claude/skills/quest-start/SKILL.md").is_file());
	assert!(dir.path().join(".claude/skills").is_symlink());

	uninstall(dir.path());
	assert!(!dir.path().join(".agents/skills").exists());
	assert!(!dir.path().join(".claude/skills").is_symlink());
}

#[test]
fn init_refuses_two_skill_directories() {
	let dir = repo();
	std::fs::create_dir_all(dir.path().join(".claude/skills")).unwrap();
	std::fs::create_dir_all(dir.path().join(".agents/skills")).unwrap();
	let err = quest::setup::init(dir.path()).unwrap_err();
	assert!(err.to_string().contains("both"));
}

#[test]
fn uninstall_is_idempotent() {
	let dir = repo();
	init(dir.path());
	uninstall(dir.path());
	assert!(uninstall(dir.path()).is_empty());
}

#[test]
fn init_keeps_a_reworded_reference_line() {
	let dir = repo();
	let custom = "Quests: run `quest guide` first; skills live upstream.";
	std::fs::write(dir.path().join("AGENTS.md"), format!("# Repo\n\n{custom}\n")).unwrap();
	init(dir.path());
	let agents = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();
	assert_eq!(agents, format!("# Repo\n\n{custom}\n"));

	uninstall(dir.path());
	let agents = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();
	assert_eq!(agents, "# Repo\n");
}
