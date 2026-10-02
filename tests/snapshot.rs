//! Native adapters and explicit snapshots use the same rules and readiness.

use quest::tree::{Document, Snapshot, evaluate};
use std::path::Path;
use tempfile::TempDir;

fn fixture() -> Snapshot {
	Snapshot {
		documents: vec![
			Document {
				path: "quest/README.md".into(),
				content: "# Quests\n\n## Goal\n\nRoadmap.\n\n## Required\n\n- [One](/quest/one.md)\n".into(),
			},
			Document {
				path: "quest/one.md".into(),
				content:
					"# [S] One\n\n## Goal\n\nSee [asset](/assets/image.png), [directory](/assets), and [root](/).\n"
						.into(),
			},
		],
		paths: ["quest", "quest/README.md", "quest/one.md", "assets", "assets/image.png"]
			.into_iter()
			.map(str::to_string)
			.collect(),
	}
}

#[test]
fn native_and_snapshot_results_match_with_untracked_assets() {
	let dir = TempDir::new().unwrap();
	let mut snapshot = fixture();
	for document in &snapshot.documents {
		let path = dir.path().join(&document.path);
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, &document.content).unwrap();
	}
	std::fs::create_dir(dir.path().join("assets")).unwrap();
	std::fs::write(dir.path().join("assets/image.png"), [0xff, 0, 0x80]).unwrap();
	for claimed in [false, true] {
		if claimed {
			snapshot.documents[1]
				.content
				.push_str("\n## Claim\n\n- Jane Doe (github:jdoe) on fork since 2026-10-02\n");
			std::fs::write(dir.path().join("quest/one.md"), &snapshot.documents[1].content).unwrap();
		}
		let result = evaluate(&snapshot, Some(Path::new("quest/one.md"))).unwrap();
		assert_eq!(result.findings, quest::check(dir.path()).unwrap());
		assert_eq!(result.ready, quest::ready::quests(dir.path(), None).unwrap());
		assert_eq!(
			result.blockers.unwrap(),
			quest::ready::blockers(dir.path(), Path::new("quest/one.md"), None).unwrap()
		);
	}
	std::fs::remove_file(dir.path().join("assets/image.png")).unwrap();
	snapshot.paths.retain(|path| path != "assets/image.png");
	assert_eq!(
		evaluate(&snapshot, None).unwrap().findings,
		quest::check(dir.path()).unwrap()
	);
}

#[test]
fn claim_removal_ignores_fenced_examples_and_preserves_other_bytes() {
	let source = "# [S] One\r\n\r\n## Goal\r\n\r\n````markdown\r\n## Claim\r\n- fake\r\n````\r\n\r\n## Claim\r\n\r\n- Jane Doe (github:jdoe) on fork since 2026-10-02\r\n\r\n## Plan\r\n\r\nKeep this.\r\n";
	let expected = source.replace(
		"## Claim\r\n\r\n- Jane Doe (github:jdoe) on fork since 2026-10-02\r\n\r\n",
		"",
	);
	assert_eq!(quest::claim::remove(source).unwrap(), expected);
	assert!(quest::claim::remove("## Claim\n\n- invalid\n").is_err());
	assert!(
		quest::claim::remove(
			"## Claim\n\n- Jane (github:j) on fork since 2026-10-02\n\n## Claim\n\n- Jane (github:j) on fork since 2026-10-02\n"
		)
		.is_err()
	);
}

#[cfg(unix)]
#[test]
fn native_and_snapshot_agree_on_symlink_files_and_directory_links() {
	use std::os::unix::fs::symlink;
	let dir = TempDir::new().unwrap();
	let mut snapshot = fixture();
	snapshot.documents[1]
		.content
		.push_str("\nSee [alias](/alias/image.png) and [symlink](/linked.png).\n");
	snapshot.paths.extend(
		["alias", "alias/image.png", "linked.png"]
			.into_iter()
			.map(str::to_string),
	);
	for document in &snapshot.documents {
		let path = dir.path().join(&document.path);
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, &document.content).unwrap();
	}
	std::fs::create_dir(dir.path().join("assets")).unwrap();
	std::fs::write(dir.path().join("assets/image.png"), [0xff]).unwrap();
	symlink("assets", dir.path().join("alias")).unwrap();
	symlink("assets/image.png", dir.path().join("linked.png")).unwrap();
	assert_eq!(
		evaluate(&snapshot, None).unwrap().findings,
		quest::check(dir.path()).unwrap()
	);
	std::fs::remove_file(dir.path().join("assets/image.png")).unwrap();
	snapshot
		.paths
		.retain(|path| !["assets/image.png", "alias/image.png", "linked.png"].contains(&path.as_str()));
	assert_eq!(
		evaluate(&snapshot, None).unwrap().findings,
		quest::check(dir.path()).unwrap()
	);
}

#[test]
fn snapshot_rejects_noncanonical_or_missing_paths_and_preserves_order() {
	let original = fixture();
	let expected = serde_json::to_value(evaluate(&original, None).unwrap()).unwrap();
	let mut reordered = original.clone();
	reordered.documents.reverse();
	reordered.paths.reverse();
	assert_eq!(
		serde_json::to_value(evaluate(&reordered, None).unwrap()).unwrap(),
		expected
	);
	let mut absent = original.clone();
	absent.paths.retain(|p| p != "quest/one.md");
	assert!(
		evaluate(&absent, None)
			.unwrap_err()
			.to_string()
			.contains("absent from path inventory")
	);
	for path in ["/quest/one.md", "quest/../one.md", "quest//one.md"] {
		let mut invalid = original.clone();
		invalid.paths.push(path.into());
		assert!(
			evaluate(&invalid, None)
				.unwrap_err()
				.to_string()
				.contains("invalid repository path")
		);
	}
}
