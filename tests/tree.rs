//! Every rule, each proven to actually fail, and the readiness the same tree
//! answers.
//!
//! A validator that silently stopped enforcing a rule is indistinguishable from
//! a clean tree, so each case starts from the same valid fixture and breaks
//! exactly one thing. The cases that must still PASS matter just as much: the
//! shell version this replaced was rewritten precisely because it rejected
//! legitimate Markdown and accepted the shapes it was written to catch.

use std::path::Path;

use tempfile::TempDir;

#[test]
fn agent_instructions_are_not_quests() {
	let tree = Tree::new();
	for path in ["quest/AGENTS.md", "quest/CLAUDE.md", "quest/m0/AGENTS.md"] {
		tree.write(path, "# Instructions\n\n## Workflow\n\nNot a quest.\n");
	}
	tree.accepts();
	assert_eq!(quest::collect(tree.path()).unwrap().len(), 5);
	assert_eq!(tree.ready(), ["quest/m0/line/one.md"]);
}

#[test]
fn empty_permanent_root_is_valid_and_has_no_ready_work() {
	let tree = Tree(TempDir::new().expect("tempdir"));
	tree.write("quest/README.md", "# Quests\n\n## Goal\n\nNew repository.\n");
	tree.accepts();
	assert!(tree.ready().is_empty());
}

#[test]
fn crlf_documents_preserve_validation_and_readiness() {
	let tree = Tree::new();
	for path in quest::collect(tree.path()).unwrap() {
		let text = std::fs::read_to_string(tree.path().join(&path)).unwrap();
		tree.write(path.to_str().unwrap(), &text.replace('\n', "\r\n"));
	}
	tree.accepts();
	assert_eq!(tree.ready(), ["quest/m0/line/one.md"]);
	assert_eq!(tree.blockers("quest/m0/line/two.md"), ["quest/m0/line/one.md"]);
}

const ROOT_README: &str = "\
# Quests

## Goal

The permanent root questline.

## Required

- [M0](/quest/m0/README.md)
";

const M0_README: &str = "\
# M0

## Goal

A milestone.

## Required

- [Line](/quest/m0/line/README.md)
";

const LINE_README: &str = "\
# Line

## Goal

A questline.

## Required

- [One](/quest/m0/line/one.md)
- [Two](/quest/m0/line/two.md)
";

const ONE: &str = "\
# [S] One

## Goal

A quest.
";

const TWO: &str = "\
# [S] Two

## Goal

Another quest.

## Required

- [One](/quest/m0/line/one.md) - must finish first
";

/// A minimal but complete tree: root questline -> milestone -> questline -> two
/// quests, one blocking the other.
struct Tree(TempDir);

impl Tree {
	fn new() -> Tree {
		let tree = Tree(TempDir::new().expect("tempdir"));
		tree.write("quest/README.md", ROOT_README);
		tree.write("quest/m0/README.md", M0_README);
		tree.write("quest/m0/line/README.md", LINE_README);
		tree.write("quest/m0/line/one.md", ONE);
		tree.write("quest/m0/line/two.md", TWO);
		tree
	}

	fn path(&self) -> &Path {
		self.0.path()
	}

	fn write(&self, rel: &str, body: &str) -> &Tree {
		let path = self.path().join(rel);
		std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
		std::fs::write(path, body).expect("write");
		self
	}

	fn append(&self, rel: &str, body: &str) -> &Tree {
		let path = self.path().join(rel);
		let existing = std::fs::read_to_string(&path).expect("read");
		std::fs::write(path, format!("{existing}{body}")).expect("write");
		self
	}

	fn findings(&self) -> Vec<String> {
		quest::check(self.path())
			.expect("check")
			.iter()
			.map(ToString::to_string)
			.collect()
	}

	/// The rendered blocker chain: one line per blocker, nesting indented.
	fn blockers(&self, path: &str) -> Vec<String> {
		quest::ready::blockers(self.path(), Path::new(path), None)
			.expect("blockers")
			.iter()
			.flat_map(|blocker| blocker.to_string().lines().map(str::to_owned).collect::<Vec<_>>())
			.collect()
	}

	fn ready(&self) -> Vec<String> {
		self.ready_on(None)
	}

	fn ready_on(&self, remote: Option<&str>) -> Vec<String> {
		quest::ready::quests(self.path(), remote)
			.expect("ready")
			.iter()
			.map(|path| path.display().to_string())
			.collect()
	}

	fn git(&self, args: &[&str]) -> &Tree {
		let status = std::process::Command::new("git")
			.arg("-C")
			.arg(self.path())
			.args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
			.args(args)
			.status()
			.expect("git");
		assert!(status.success(), "git {args:?}");
		self
	}

	/// Commit the fixture to `main`, with an `origin` that is never contacted.
	fn init_git(&self) -> &Tree {
		self.git(&["init", "-q", "-b", "main"])
			.git(&["remote", "add", "origin", "https://example.invalid/repo.git"])
			.commit("main")
	}

	fn commit(&self, message: &str) -> &Tree {
		self.git(&["add", "-A"]).git(&["commit", "-q", "-m", message])
	}

	/// Commit whatever `edit` does as the remote copy of `branch`, then put the
	/// working tree back on `main`.
	fn push_line(&self, branch: &str, edit: impl FnOnce(&Tree)) -> &Tree {
		self.git(&["checkout", "-q", "-b", branch]);
		edit(self);
		self.commit(branch)
			.git(&["update-ref", &format!("refs/remotes/origin/{branch}"), "HEAD"])
			.git(&["checkout", "-q", "main"])
	}

	fn remove(&self, rel: &str) -> &Tree {
		let path = self.path().join(rel);
		if path.is_dir() {
			std::fs::remove_dir_all(path).expect("rm");
		} else {
			std::fs::remove_file(path).expect("rm");
		}
		self
	}

	fn branch(&self, path: &str) -> Vec<String> {
		quest::branch::chain(self.path(), Path::new(path)).expect("branch")
	}

	fn branch_err(&self, path: &str) -> String {
		quest::branch::chain(self.path(), Path::new(path))
			.expect_err("expected no branch")
			.to_string()
	}

	#[track_caller]
	fn accepts(&self) {
		let findings = self.findings();
		assert!(findings.is_empty(), "expected the tree to pass, got: {findings:#?}");
	}

	#[track_caller]
	fn without(&self, unexpected: &str) {
		let findings = self.findings();
		assert!(
			!findings.iter().any(|f| f.contains(unexpected)),
			"expected NO finding containing {unexpected:?}, got: {findings:#?}"
		);
	}

	#[track_caller]
	fn rejects(&self, expected: &str) {
		let findings = self.findings();
		assert!(
			findings.iter().any(|f| f.contains(expected)),
			"expected a finding containing {expected:?}, got: {findings:#?}"
		);
	}
}

/// The fixture itself has to pass, or every case below proves nothing.
#[test]
fn baseline_is_valid() {
	Tree::new().accepts();
}

#[test]
fn dangling_absolute_link() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Related\n\n- [Gone](/quest/m0/line/gone.md) - completed and deleted\n",
	);
	tree.rejects("link does not resolve: /quest/m0/line/gone.md");
}

/// Relative links escape the tree (AGENTS.md points at ../CONTRIBUTING.md), so
/// they resolve against the LINKING FILE's directory. The pair of cases pins the
/// direction: resolving against the wrong base would flip both verdicts.
#[test]
fn relative_link_resolves_against_the_linking_file() {
	let tree = Tree::new();
	tree.write("AGENTS.md", "# Guide\n");
	tree.append(
		"quest/m0/line/one.md",
		"\n## Plan\n\nSee [the guide](../../../AGENTS.md).\n",
	);
	tree.accepts();
}

#[test]
fn relative_link_above_the_repository_root() {
	let tree = Tree::new();
	tree.write("AGENTS.md", "# Guide\n");
	// One `..` too many, which is exactly what a file flattened up a level
	// keeps: it still renders, and points at nothing.
	tree.append(
		"quest/m0/line/one.md",
		"\n## Plan\n\nSee [the guide](../../../../AGENTS.md).\n",
	);
	tree.rejects("link does not resolve: ../../../../AGENTS.md");
}

/// Quests reference each other root-absolutely. A relative one renders fine, so
/// nothing else would notice - but it is invisible to the dependency graph.
#[test]
fn relative_link_to_a_quest() {
	let tree = Tree::new();
	tree.append("quest/m0/line/one.md", "\n## Related\n\n- [Two](two.md) - a sibling\n");
	tree.rejects("link to a quest must be root-absolute: two.md (write /quest/m0/line/two.md)");
}

/// Templates inside fenced blocks are illustrations. Flagging AGENTS.md's own
/// example would make this a check everyone learns to skip.
#[test]
fn fenced_templates_are_not_links() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Plan\n\n```markdown\n## Required\n\n- [Blocker](/quest/foo/bar.md) - must finish first\n```\n",
	);
	tree.accepts();
}

/// A fence longer than three backticks may contain shorter ones, and `~~~` is a
/// fence too. Miscounting either inverts the fence state and silently skips the
/// REST OF THE FILE - the worst failure this tool has, because it looks clean.
#[test]
fn nested_and_tilde_fences_do_not_leak() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Plan\n\n````markdown\n```bash\njust check\n```\n````\n\n~~~text\n```\n~~~\n\n## Requires\n\n- [Gone](/quest/m0/line/gone.md) - typo'd heading and a dangling link\n",
	);
	tree.rejects("unknown '## Requires'");
	tree.rejects("link does not resolve: /quest/m0/line/gone.md");
}

#[test]
fn missing_goal() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/one.md",
		"# [S] One\n\n## Plan\n\nA quest with no stated outcome.\n",
	);
	tree.rejects("missing '## Goal'");
}

#[test]
fn quest_title_needs_a_size() {
	let tree = Tree::new();
	tree.write("quest/m0/line/one.md", &ONE.replace("# [S] One", "# One"));
	tree.rejects("quest title must be '# [XS|S|M|L|XL] Title'");
}

#[test]
fn quest_title_accepts_xl() {
	let tree = Tree::new();
	tree.write("quest/m0/line/one.md", &ONE.replace("# [S] One", "# [XL] One"));
	tree.accepts();
}

#[test]
fn quest_title_rejects_xxl() {
	let tree = Tree::new();
	tree.write("quest/m0/line/one.md", &ONE.replace("# [S] One", "# [XXL] One"));
	tree.rejects("quest title must be '# [XS|S|M|L|XL] Title'");
}

/// The closed vocabulary exists for this: readiness greps `## Required`
/// literally, so a typo makes a blocked quest read as ready and fails nowhere.
#[test]
fn typo_in_a_heading() {
	let tree = Tree::new();
	tree.write("quest/m0/line/two.md", &TWO.replace("## Required", "## Requires"));
	tree.rejects("unknown '## Requires'");
}

/// A README whose last child merged is the line's own remaining work: a leaf
/// quest, sized and listed as ready like any other.
#[test]
fn readme_without_an_index_is_a_quest() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/sub/README.md",
		"# Sub\n\n## Goal\n\nThe end-to-end test once every child has merged.\n",
	);
	tree.append("quest/m0/line/README.md", "- [Sub](/quest/m0/line/sub/README.md)\n");
	tree.rejects("quest title must be");
	tree.write(
		"quest/m0/line/sub/README.md",
		"# [S] Sub\n\n## Goal\n\nThe end-to-end test once every child has merged.\n",
	);
	tree.accepts();
	assert!(tree.ready().contains(&"quest/m0/line/sub/README.md".to_string()));
}

/// Completing a questline's last quest removes its heading with the entry, or
/// deletes the directory. A bare `## Required` would block the husk forever.
#[test]
fn empty_questline_index() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/husk/README.md",
		"# Husk\n\n## Goal\n\nIts last quest was completed.\n\n## Required\n",
	);
	tree.append("quest/m0/README.md", "- [Husk](/quest/m0/husk/README.md)\n");
	tree.rejects("'## Required' is empty");
}

/// The absence of `## Required` means ready. A heading left behind by its last
/// blocker reads as blocked to every readiness check, forever.
#[test]
fn empty_required_section() {
	let tree = Tree::new();
	tree.append("quest/m0/line/one.md", "\n## Required\n");
	tree.rejects("'## Required' is empty");
}

#[test]
fn unlisted_quest() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/three.md",
		"# [S] Three\n\n## Goal\n\nA quest nobody indexed.\n",
	);
	tree.rejects("not listed in quest/m0/line/README.md's '## Required'");
}

/// Children are the entries that sit directly under the line, so a milestone
/// requiring a grandchild only waits on it; the line still owns it.
#[test]
fn requiring_a_grandchild_is_a_blocker() {
	let tree = Tree::new();
	tree.append("quest/m0/README.md", "- [One](/quest/m0/line/one.md)\n");
	tree.accepts();
	assert_eq!(tree.ready(), ["quest/m0/line/one.md"]);
}

#[test]
fn quest_listed_twice() {
	let tree = Tree::new();
	tree.append("quest/m0/line/README.md", "- [One again](/quest/m0/line/one.md)\n");
	tree.rejects("requires /quest/m0/line/one.md twice");
}

#[test]
fn relative_index_entry() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/README.md",
		&LINE_README.replace("(/quest/m0/line/one.md)", "(one.md)"),
	);
	tree.rejects("link to a quest must be root-absolute: one.md");
}

/// A target that merely exists is not enough: quest/AGENTS.md is a file under
/// quest/ that nothing can finish.
#[test]
fn index_entry_that_is_not_a_quest() {
	let tree = Tree::new();
	tree.write("quest/AGENTS.md", "# Contract\n");
	tree.append("quest/README.md", "- [Contract](/quest/AGENTS.md)\n");
	tree.rejects("requires /quest/AGENTS.md, which is not a quest document");
}

/// The index is a list of entries, not prose that happens to link.
#[test]
fn prose_under_the_index() {
	let tree = Tree::new();
	tree.append("quest/m0/line/README.md", "\nSee also [One](/quest/m0/line/one.md).\n");
	tree.rejects("mid-sentence");
}

#[test]
fn direct_required_cycle() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [Two](/quest/m0/line/two.md) - must finish first\n",
	);
	tree.rejects("Required cycle:");
}

/// A quest may require a whole questline, so the deadlock can span the README.
/// The cycle here runs strictly OUTSIDE-IN: `outer` (in m0) requires the line
/// questline, and `three` inside that questline requires `outer` back. No quest
/// requires its own questline, so containment edges are the only thing that can
/// close it.
#[test]
fn cycle_through_a_questline() {
	let tree = Tree::new();
	tree.append("quest/m0/README.md", "- [Outer](/quest/m0/outer.md)\n");
	tree.write(
		"quest/m0/outer.md",
		"# [S] Outer\n\n## Goal\n\nBlocked on a whole questline.\n\n## Required\n\n- [Line](/quest/m0/line/README.md) - the whole questline must finish\n",
	);
	tree.append("quest/m0/line/README.md", "- [Three](/quest/m0/line/three.md)\n");
	tree.write(
		"quest/m0/line/three.md",
		"# [S] Three\n\n## Goal\n\nInside the questline that blocks it.\n\n## Required\n\n- [Outer](/quest/m0/outer.md) - must finish first\n",
	);
	tree.rejects(
		"Required cycle: quest/m0/line/README.md -> quest/m0/line/three.md -> quest/m0/outer.md -> quest/m0/line/README.md",
	);
}

/// A `#fragment` addresses a place inside a file, not a different file. Keeping
/// it on made a phantom graph node that no quest could match, so a cycle through
/// an anchored link went unreported.
#[test]
fn cycle_through_an_anchored_link() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [Two](/quest/m0/line/two.md#plan) - must finish first\n",
	);
	tree.rejects("Required cycle:");
}

/// Reference-style links render as real dependencies, so they must carry real
/// edges. A line-oriented parser saw no `](` here and produced none.
#[test]
fn cycle_through_a_reference_style_link() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [Two][two] - must finish first\n\n[two]: /quest/m0/line/two.md\n",
	);
	tree.rejects("Required cycle:");
}

/// moq-dev/moq.pro#1170: a customer-gate sentence that happens to link a
/// questline mid-sentence reads as context but IS a dependency edge.
#[test]
fn required_link_mid_sentence() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- A customer who also justifies [the line](/quest/m0/line/README.md).\n",
	);
	tree.rejects("mid-sentence");
}

/// The same failure, reflowed onto a second line. The link is no longer on the
/// bullet's first line, which is all it took to slip past the shell version.
#[test]
fn required_link_on_a_wrapped_bullet() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- A customer who also justifies\n  [the line](/quest/m0/line/README.md).\n",
	);
	tree.rejects("mid-sentence");
}

/// An outside condition is its own quest, so it keeps surfacing as ready
/// instead of hiding the quest it blocks from every ready listing. The bullet
/// wraps here because that is what such bullets in trees actually looked like.
#[test]
fn required_external_condition() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- A `moq-video` release that carries\n  the encoder\n",
	);
	tree.rejects("requires A moq-video release that carries the encoder, which is not a quest document");
}

/// An issue or release link is outside the tree too; only a quest can clear.
#[test]
fn required_external_link() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [#1](https://github.com/OWNER/REPO/issues/1) - upstream fix\n",
	);
	tree.rejects("requires https://github.com/OWNER/REPO/issues/1, which is not a quest document");
}

/// A LOOSE list - blank lines between entries - wraps every item in a paragraph.
/// Treating that paragraph as text would classify every entry in the list as
/// mid-sentence prose, which is a false positive on ordinary Markdown and would
/// fire on every blocker and every index entry at once.
#[test]
fn loose_index_list() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/README.md",
		"# Line\n\n## Goal\n\nA questline.\n\n## Required\n\n- [One](/quest/m0/line/one.md)\n\n- [Two](/quest/m0/line/two.md)\n",
	);
	tree.accepts();
}

#[test]
fn loose_required_list() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [Two](/quest/m0/line/two.md) - must finish first\n\n- [Line](/quest/m0/line/README.md) - the whole line\n",
	);
	// Both edges registered (hence the cycle) without reading as prose.
	tree.rejects("Required cycle:");
	tree.without("mid-sentence");
}

/// The other side of the same seam: a link opening a SECOND paragraph is inside
/// the item, not opening it.
#[test]
fn required_link_in_a_later_paragraph() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- A customer who justifies the work.\n\n  [The line](/quest/m0/line/README.md) would follow.\n",
	);
	tree.rejects("mid-sentence");
}

/// A blocker written with emphasis still opens its bullet. Rejecting it would
/// be a false positive on legitimate Markdown.
#[test]
fn required_link_with_emphasis() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- **[Two](/quest/m0/line/two.md)** - must finish first\n",
	);
	tree.rejects("Required cycle:");
}

/// A setext underline renders as an H2 and this validator would read the quest
/// as blocked - but readiness greps `^## Required$` and would call it READY.
/// Two tools disagreeing about the same file is the whole failure.
#[test]
fn setext_heading() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\nRequired\n--------\n\n- [Two](/quest/m0/line/two.md) - must finish first\n",
	);
	tree.rejects("must be written literally as '## Required'");
}

#[test]
fn decorated_heading() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## `Required`\n\n- [Two](/quest/m0/line/two.md) - must finish first\n",
	);
	tree.rejects("must be written literally as '## Required'");
}

/// A bullet nested under a prose lead-in is illustration, not a blocker. Reading
/// it as one is #1170 again, wearing an indent.
#[test]
fn nested_required_entry() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- Customer evidence:\n  - [The line](/quest/m0/line/README.md)\n",
	);
	tree.rejects("mid-sentence");
}

#[test]
fn blockquoted_required_entry() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- Quoting the old plan:\n\n  > - [The line](/quest/m0/line/README.md)\n",
	);
	tree.rejects("mid-sentence");
}

/// Repeated `..` must not cancel each other on the way up. Popping
/// unconditionally let a link climb above the root and walk back down to a real
/// file, so a badly flattened path resolved and reported nothing.
#[test]
fn repeated_parent_components() {
	let tree = Tree::new();
	tree.write("AGENTS.md", "# Guide\n");
	tree.append(
		"quest/m0/line/one.md",
		"\n## Plan\n\nSee [the guide](../../../../../AGENTS.md).\n",
	);
	tree.rejects("link does not resolve: ../../../../../AGENTS.md");
}

/// Escaping the root must fail even when the joined path happens to exist:
/// the repository's own directory name (or a sibling worktree) sits beside the
/// root, so `<root>/../<name>/AGENTS.md` is a real file that readers of the
/// repository-relative link can never reach.
#[test]
fn escaped_link_resolving_beside_the_root() {
	let tree = Tree::new();
	tree.write("AGENTS.md", "# Guide\n");
	let name = tree.path().file_name().unwrap().to_str().unwrap();
	tree.append(
		"quest/m0/line/one.md",
		&format!("\n## Plan\n\nSee [the guide](../../../../{name}/AGENTS.md).\n"),
	);
	tree.rejects(&format!("link does not resolve: ../../../../{name}/AGENTS.md"));
}

/// A blocker outside the line's directory is not a child, so a README holding
/// only one is a quest and needs a size like any other.
#[test]
fn questline_listing_no_quest() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/husk/README.md",
		"# Husk\n\n## Goal\n\nIts last quest was completed.\n\n## Required\n\n- [One](/quest/m0/line/one.md)\n",
	);
	tree.append("quest/m0/README.md", "- [Husk](/quest/m0/husk/README.md)\n");
	tree.rejects("quest title must be");
}

#[test]
fn empty_related_section() {
	let tree = Tree::new();
	tree.append("quest/m0/line/one.md", "\n## Related\n");
	tree.rejects("'## Related' is empty");
}

#[test]
fn empty_closes_section() {
	let tree = Tree::new();
	tree.append("quest/m0/line/one.md", "\n## Closes\n");
	tree.rejects("'## Closes' is empty");
}

/// Trailing whitespace is invisible in a diff and `rg '^## Required$'` does not
/// match it either, so accepting it recreates the same disagreement a setext
/// heading does.
#[test]
fn heading_with_trailing_space() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required  \n\n- [Two](/quest/m0/line/two.md) - must finish first\n",
	);
	tree.rejects("must be written literally as '## Required'");
}

/// The index and the cycle walk key on the same normalized path. A `..` left in
/// either makes a node nothing can match, so the cycle through it disappears.
#[test]
fn cycle_through_an_unnormalized_link() {
	let tree = Tree::new();
	tree.append(
		"quest/m0/line/one.md",
		"\n## Required\n\n- [Two](/quest/m0/line/../line/two.md) - must finish first\n",
	);
	tree.rejects("Required cycle:");
}

// Readiness: what `quest ready` reports about the same fixture. A blocker list
// is the machine-readable result, so the cases that must come back EMPTY carry
// as much weight as the ones that must not.

/// The absence of `## Required` is the whole definition of ready.
#[test]
fn ready_quest_has_no_blockers() {
	let tree = Tree::new();
	assert!(tree.blockers("quest/m0/line/one.md").is_empty());
}

#[test]
fn blocked_by_a_quest() {
	let tree = Tree::new();
	assert_eq!(tree.blockers("quest/m0/line/two.md"), ["quest/m0/line/one.md"]);
}

/// A questline blocker clears only when the whole line is complete, so the
/// useful answer is which of its quests are still open - all of them, since a
/// completed quest is deleted.
#[test]
fn blocked_by_a_questline() {
	let tree = Tree::new();
	tree.append("quest/m0/README.md", "- [Outer](/quest/m0/outer.md)\n");
	tree.write(
		"quest/m0/outer.md",
		"# [S] Outer\n\n## Goal\n\nBlocked on a whole questline.\n\n## Required\n\n- [Line](/quest/m0/line/README.md) - the whole questline must finish\n",
	);
	assert_eq!(
		tree.blockers("quest/m0/outer.md"),
		[
			"quest/m0/line/README.md",
			"  quest/m0/line/one.md",
			"  quest/m0/line/two.md",
		]
	);
}

/// A required QUEST does not expand: its own blockers are its readiness, and
/// running this on it is how you ask. Expanding buried the entries that were
/// asked for under a subtree repeated once per path through it.
#[test]
fn a_required_quest_is_not_expanded() {
	let tree = Tree::new();
	tree.append("quest/m0/line/README.md", "- [Three](/quest/m0/line/three.md)\n");
	tree.write(
		"quest/m0/line/three.md",
		"# [S] Three\n\n## Goal\n\nLast in the chain.\n\n## Required\n\n- [Two](/quest/m0/line/two.md) - must finish first\n",
	);
	assert_eq!(tree.blockers("quest/m0/line/three.md"), ["quest/m0/line/two.md"]);
}

/// `quest check` reports an empty `## Required` as a defect, and every reader
/// that greps for the heading calls the quest blocked. Reading it as ready here
/// would make this the one tool that disagrees.
#[test]
fn empty_required_section_still_blocks() {
	let tree = Tree::new();
	tree.append("quest/m0/line/one.md", "\n## Required\n");
	assert_eq!(
		tree.blockers("quest/m0/line/one.md"),
		["an empty '## Required' section, which blocks the quest until the heading is removed"]
	);
}

/// The listing is the query the start flow reproduces by grepping. A questline
/// is absent while it still indexes children, and `two.md` is blocked.
#[test]
fn ready_listing() {
	let tree = Tree::new();
	assert_eq!(tree.ready(), ["quest/m0/line/one.md"]);

	tree.append("quest/m0/README.md", "- [Outer](/quest/m0/outer.md)\n");
	tree.write("quest/m0/outer.md", "# [S] Outer\n\n## Goal\n\nReady too.\n");
	assert_eq!(tree.ready(), ["quest/m0/line/one.md", "quest/m0/outer.md"]);
}

/// `quest check` proves the graph acyclic, but readiness also runs on trees
/// nobody has checked yet - the branch that just introduced the cycle - and a
/// cycle there has to print rather than recurse forever.
#[test]
fn cycle_terminates() {
	let tree = Tree::new();
	tree.append("quest/m0/line/README.md", "- [Itself](/quest/m0/line/README.md)\n");
	tree.append("quest/m0/README.md", "- [Outer](/quest/m0/outer.md)\n");
	tree.write(
		"quest/m0/outer.md",
		"# [S] Outer\n\n## Goal\n\nBlocked on a questline that lists itself.\n\n## Required\n\n- [Line](/quest/m0/line/README.md) - the whole questline must finish\n",
	);
	assert_eq!(
		tree.blockers("quest/m0/outer.md"),
		[
			"quest/m0/line/README.md",
			"  quest/m0/line/one.md",
			"  quest/m0/line/two.md",
			"  quest/m0/line/README.md",
		]
	);
}

#[test]
fn ready_listing_follows_nested_priority_and_terminates_cycles() {
	let tree = Tree::new();
	tree.write("quest/m0/line/two.md", "# [S] Two\n\n## Goal\n\nReady.\n");
	tree.write("quest/m0/line/README.md", "# Line\n\n## Required\n\n- [Two](/quest/m0/line/two.md)\n- [Self](/quest/m0/line/README.md)\n- [One](/quest/m0/line/one.md)\n");
	assert_eq!(tree.ready(), ["quest/m0/line/two.md", "quest/m0/line/one.md"]);
}

#[test]
fn ready_listing_appends_unindexed_quests() {
	let tree = Tree::new();
	tree.write("quest/m0/aaa.md", "# [S] Unindexed\n\n## Goal\n\nDiscover me.\n");
	tree.write(
		"quest/m0/blocked.md",
		"# [S] Blocked\n\n## Goal\n\nWait.\n\n## Required\n\n- [One](/quest/m0/line/one.md)\n",
	);
	assert_eq!(tree.ready(), ["quest/m0/line/one.md", "quest/m0/aaa.md"]);
}

/// The chain is the path: the leaf, its line's README, then `main`. Nothing
/// consults git.
#[test]
fn branch_chain_of_a_quest() {
	let tree = Tree::new();
	assert_eq!(
		tree.branch("quest/m0/line/one.md"),
		["quest/m0/line/one", "quest/m0/line/README", "main"]
	);
	assert_eq!(
		tree.branch("/quest/m0/line/README.md"),
		["quest/m0/line/README", "main"]
	);
}

/// Neither the root nor a milestone has a branch; their children merge into `main`.
#[test]
fn root_and_milestone_have_no_branch() {
	let tree = Tree::new();
	assert!(tree.branch_err("quest/README.md").contains("no branch"));
	assert!(tree.branch_err("quest/m0/README.md").contains("no branch"));
}

/// Every milestone's work branches from `main`, whatever its priority: starting a
/// quest never moves it.
#[test]
fn later_milestone_branches_from_main() {
	let tree = Tree::new();
	tree.write(
		"quest/m2/README.md",
		"# m2\n\n## Goal\n\nLater work.\n\n## Required\n\n- [Later](/quest/m2/later.md)\n",
	);
	tree.write("quest/m2/later.md", "# [S] Later\n\n## Goal\n\nNot started.\n");
	tree.append("quest/README.md", "- [m2](/quest/m2/README.md)\n");
	tree.accepts();
	assert_eq!(tree.branch("quest/m2/later.md"), ["quest/m2/later", "main"]);
}

/// A milestone with nothing left is not its own work, so it needs no size and
/// never lists as ready.
#[test]
fn milestone_may_be_empty() {
	let tree = Tree::new();
	tree.write("quest/m0/README.md", "# m0\n\n## Goal\n\nEmpty for now.\n");
	std::fs::remove_dir_all(tree.path().join("quest/m0/line")).expect("rm");
	tree.accepts();
	assert!(tree.ready().is_empty(), "{:?}", tree.ready());
}

/// Lines nest to any depth: every branch ends in a leaf component (the quest
/// or `README`), so no line's branch is a path prefix of its children's, which
/// is the one shape git refuses.
#[test]
fn branch_chain_of_a_nested_line() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/sub/README.md",
		"# Sub\n\n## Goal\n\nA nested line.\n\n## Required\n\n- [Three](/quest/m0/line/sub/three.md)\n",
	);
	tree.write(
		"quest/m0/line/sub/three.md",
		"# [S] Three\n\n## Goal\n\nA nested quest.\n",
	);
	tree.append("quest/m0/line/README.md", "- [Sub](/quest/m0/line/sub/README.md)\n");
	tree.accepts();
	assert_eq!(
		tree.branch("quest/m0/line/sub/three.md"),
		[
			"quest/m0/line/sub/three",
			"quest/m0/line/sub/README",
			"quest/m0/line/README",
			"main"
		]
	);
}

// Line branches: `--remote` reads each line from its branch, where its
// children merge before the line reaches `main`.

/// `one` finished on the line's branch, so `main` still lists it as ready and
/// `two` as blocked. Read through the branch, the answer flips.
#[test]
fn line_branch_hides_quests_finished_there() {
	let tree = Tree::new();
	tree.init_git().push_line("quest/m0/line/README", |t| {
		t.remove("quest/m0/line/one.md")
			.write(
				"quest/m0/line/README.md",
				&LINE_README.replace("- [One](/quest/m0/line/one.md)\n", ""),
			)
			.write("quest/m0/line/two.md", "# [S] Two\n\n## Goal\n\nAnother quest.\n");
	});
	assert_eq!(tree.ready(), ["quest/m0/line/one.md"]);
	assert_eq!(tree.ready_on(Some("origin")), ["quest/m0/line/two.md"]);
	assert!(
		quest::ready::blockers(tree.path(), Path::new("quest/m0/line/two.md"), Some("origin"))
			.expect("blockers")
			.is_empty()
	);
}

/// The nested line's branch is newer for its own subtree than the outer
/// line's, and once the outer branch completes the nested line, a branch left
/// behind by it must not bring the finished work back.
#[test]
fn nested_line_branch_wins_until_its_line_completes() {
	let tree = Tree::new();
	tree.write(
		"quest/m0/line/sub/README.md",
		"# Sub\n\n## Goal\n\nA nested line.\n\n## Required\n\n- [Three](/quest/m0/line/sub/three.md)\n",
	)
	.write(
		"quest/m0/line/sub/three.md",
		"# [S] Three\n\n## Goal\n\nA nested quest.\n",
	)
	.append("quest/m0/line/README.md", "- [Sub](/quest/m0/line/sub/README.md)\n");
	tree.accepts();
	tree.init_git();

	// Every child of `sub` merged: its README is the line's own remaining work.
	tree.push_line("quest/m0/line/sub/README", |t| {
		t.remove("quest/m0/line/sub/three.md").write(
			"quest/m0/line/sub/README.md",
			"# [S] Sub\n\n## Goal\n\nThe end-to-end test.\n",
		);
	});
	assert_eq!(
		tree.ready_on(Some("origin")),
		["quest/m0/line/one.md", "quest/m0/line/sub/README.md"]
	);

	// Then `sub` itself landed on the outer line, whose branch has no `sub/`.
	tree.push_line("quest/m0/line/README", |t| {
		t.remove("quest/m0/line/sub")
			.write("quest/m0/line/README.md", LINE_README);
	});
	assert_eq!(tree.ready_on(Some("origin")), ["quest/m0/line/one.md"]);
}

/// A remote that does not exist is a mistake, not a tree with no line branches.
#[test]
fn unknown_remote_is_an_error() {
	let tree = Tree::new();
	tree.init_git();
	let err = quest::ready::quests(tree.path(), Some("upstream")).expect_err("unknown remote");
	assert!(err.to_string().contains("remote"), "{err}");
}
