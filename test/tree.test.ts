// Every rule, each proven to actually fail, and the readiness the same tree
// answers.
//
// A validator that silently stopped enforcing a rule is indistinguishable from
// a clean tree, so each case starts from the same valid fixture and breaks
// exactly one thing. The cases that must still PASS matter just as much: the
// shell version this replaced was rewritten precisely because it rejected
// legitimate Markdown and accepted the shapes it was written to catch.

import { basename } from "node:path";

import { describe, expect, test } from "vitest";

import { collect } from "../src/cli/tree";
import { EPIC_README, ONE, TWO, Tree } from "./fixture";

const tree = Tree.baseline;

test("agent instructions are not quests", () => {
	const t = tree();
	for (const path of ["quest/AGENTS.md", "quest/CLAUDE.md", "quest/a0/AGENTS.md"]) {
		t.write(path, "# Instructions\n\n## Workflow\n\nNot a quest.\n");
	}
	t.accepts();
	expect(collect(t.path)).toHaveLength(5);
	expect(t.ready()).toEqual(["quest/a0/epic/one.md"]);
});

test("an empty permanent root is valid and has no ready work", () => {
	const t = new Tree().write("quest/README.md", "# Quests\n\n## Goal\n\nNew repository.\n");
	t.accepts();
	expect(t.ready()).toEqual([]);
});

const CLAIM = "\n## Claim\n\n- Jane Doe (github:jdoe) on https://example.com/jdoe/repo since 2026-10-02";

describe("retired claims", () => {
	test.each([CLAIM, "\n## Claim\n", "\n## Claim\n\n- Jane\n"])(
		"a Claim section is unknown and does not block readiness: %j",
		(claim) => {
			const t = tree().append("quest/a0/epic/one.md", claim);
			t.rejects("unknown '## Claim'");
			expect(t.ready()).toEqual(["quest/a0/epic/one.md"]);
			expect(t.blockers("quest/a0/epic/one.md")).toEqual([]);
			expect(t.run("ready", "quest/a0/epic/one.md")).toEqual({ code: 0, stdout: "", stderr: "" });
		},
	);

	test("Required entries remain the only blockers when a legacy claim exists", () => {
		const t = tree().append("quest/a0/epic/two.md", CLAIM);
		t.rejects("unknown '## Claim'");
		expect(t.blockers("quest/a0/epic/two.md")).toEqual(["quest/a0/epic/one.md"]);
	});
});

test("CRLF documents preserve validation and readiness", () => {
	const t = tree();
	for (const path of collect(t.path)) t.write(path, t.read(path).replaceAll("\n", "\r\n"));
	t.accepts();
	expect(t.ready()).toEqual(["quest/a0/epic/one.md"]);
	expect(t.blockers("quest/a0/epic/two.md")).toEqual(["quest/a0/epic/one.md"]);
});

/** The fixture itself has to pass, or every case below proves nothing. */
test("the baseline is valid", () => {
	tree().accepts();
});

describe("links", () => {
	test("a dangling absolute link", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Related\n\n- [Gone](/quest/a0/epic/gone.md) - completed and deleted\n",
			)
			.rejects("link does not resolve: /quest/a0/epic/gone.md");
	});

	// Relative links escape the tree (AGENTS.md points at ../CONTRIBUTING.md), so
	// they resolve against the LINKING FILE's directory. The pair of cases pins
	// the direction: resolving against the wrong base would flip both verdicts.
	test("a relative link resolves against the linking file", () => {
		tree()
			.write("AGENTS.md", "# Guide\n")
			.append("quest/a0/epic/one.md", "\n## Plan\n\nSee [the guide](../../../AGENTS.md).\n")
			.accepts();
	});

	test("a relative link above the repository root", () => {
		// One `..` too many, which is exactly what a file flattened up a level
		// keeps: it still renders, and points at nothing.
		tree()
			.write("AGENTS.md", "# Guide\n")
			.append("quest/a0/epic/one.md", "\n## Plan\n\nSee [the guide](../../../../AGENTS.md).\n")
			.rejects("link does not resolve: ../../../../AGENTS.md");
	});

	// Quests reference each other root-absolutely. A relative one renders fine,
	// so nothing else would notice - but it is invisible to the dependency graph.
	test("a relative link to a quest", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Related\n\n- [Two](two.md) - a sibling\n")
			.rejects("link to a quest must be root-absolute: two.md (write /quest/a0/epic/two.md)");
	});

	// Templates inside fenced blocks are illustrations. Flagging AGENTS.md's own
	// example would make this a check everyone learns to skip.
	test("fenced templates are not links", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Plan\n\n```markdown\n## Required\n\n- [Blocker](/quest/foo/bar.md) - must finish first\n```\n",
			)
			.accepts();
	});

	// A fence longer than three backticks may contain shorter ones, and `~~~` is
	// a fence too. Miscounting either inverts the fence state and silently skips
	// the REST OF THE FILE - the worst failure this tool has, because it looks
	// clean.
	test("nested and tilde fences do not leak", () => {
		const t = tree().append(
			"quest/a0/epic/one.md",
			"\n## Plan\n\n````markdown\n```bash\njust check\n```\n````\n\n~~~text\n```\n~~~\n\n## Requires\n\n- [Gone](/quest/a0/epic/gone.md) - typo'd heading and a dangling link\n",
		);
		t.rejects("unknown '## Requires'");
		t.rejects("link does not resolve: /quest/a0/epic/gone.md");
	});

	// Repeated `..` must not cancel each other on the way up. Popping
	// unconditionally let a link climb above the root and walk back down to a
	// real file, so a badly flattened path resolved and reported nothing.
	test("repeated parent components", () => {
		tree()
			.write("AGENTS.md", "# Guide\n")
			.append("quest/a0/epic/one.md", "\n## Plan\n\nSee [the guide](../../../../../AGENTS.md).\n")
			.rejects("link does not resolve: ../../../../../AGENTS.md");
	});

	// Escaping the root must fail even when the joined path happens to exist: the
	// repository's own directory name (or a sibling worktree) sits beside the
	// root, so `<root>/../<name>/AGENTS.md` is a real file that readers of the
	// repository-relative link can never reach.
	test("an escaped link resolving beside the root", () => {
		const t = tree().write("AGENTS.md", "# Guide\n");
		const name = basename(t.path);
		t.append("quest/a0/epic/one.md", `\n## Plan\n\nSee [the guide](../../../../${name}/AGENTS.md).\n`);
		t.rejects(`link does not resolve: ../../../../${name}/AGENTS.md`);
	});
});

describe("headings", () => {
	test("a missing goal", () => {
		tree()
			.write("quest/a0/epic/one.md", "# [S] One\n\n## Plan\n\nA quest with no stated outcome.\n")
			.rejects("missing '## Goal'");
	});

	test("a quest title needs a size", () => {
		tree()
			.write("quest/a0/epic/one.md", ONE.replace("# [S] One", "# One"))
			.rejects("quest title must be '# [XS|S|M|L|XL] Title'");
	});

	test("a quest title accepts XL", () => {
		tree().write("quest/a0/epic/one.md", ONE.replace("# [S] One", "# [XL] One")).accepts();
	});

	test("a quest title rejects XXL", () => {
		tree()
			.write("quest/a0/epic/one.md", ONE.replace("# [S] One", "# [XXL] One"))
			.rejects("quest title must be '# [XS|S|M|L|XL] Title'");
	});

	// The closed vocabulary exists for this: readiness greps `## Required`
	// literally, so a typo makes a blocked quest read as ready and fails nowhere.
	test("a typo in a heading", () => {
		tree()
			.write("quest/a0/epic/two.md", TWO.replace("## Required", "## Requires"))
			.rejects("unknown '## Requires'");
	});

	// A setext underline renders as an H2 and this validator would read the quest
	// as blocked - but readiness greps `^## Required$` and would call it READY.
	// Two tools disagreeing about the same file is the whole failure.
	test("a setext heading", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\nRequired\n--------\n\n- [Two](/quest/a0/epic/two.md) - must finish first\n",
			)
			.rejects("must be written literally as '## Required'");
	});

	test("a decorated heading", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## `Required`\n\n- [Two](/quest/a0/epic/two.md) - must finish first\n")
			.rejects("must be written literally as '## Required'");
	});

	// Trailing whitespace is invisible in a diff and `rg '^## Required$'` does
	// not match it either, so accepting it recreates the same disagreement a
	// setext heading does.
	test("a heading with a trailing space", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Required  \n\n- [Two](/quest/a0/epic/two.md) - must finish first\n")
			.rejects("must be written literally as '## Required'");
	});

	test("an empty Related section", () => {
		tree().append("quest/a0/epic/one.md", "\n## Related\n").rejects("'## Related' is empty");
	});

	test("an empty Closes section", () => {
		tree().append("quest/a0/epic/one.md", "\n## Closes\n").rejects("'## Closes' is empty");
	});
});

describe("index", () => {
	// A README whose last child merged is the epic's own remaining work: a leaf
	// quest, sized and listed as ready like any other.
	test("a README without an index is a quest", () => {
		const t = tree()
			.write(
				"quest/a0/epic/sub/README.md",
				"# Sub\n\n## Goal\n\nThe end-to-end test once every child has merged.\n",
			)
			.append("quest/a0/epic/README.md", "- [Sub](/quest/a0/epic/sub/README.md)\n");
		t.rejects("quest title must be");
		t.write(
			"quest/a0/epic/sub/README.md",
			"# [S] Sub\n\n## Goal\n\nThe end-to-end test once every child has merged.\n",
		);
		t.accepts();
		expect(t.ready()).toContain("quest/a0/epic/sub/README.md");
	});

	// Completing an epic's last quest removes its heading with the entry, or
	// deletes the directory. A bare `## Required` would block the husk forever.
	test("an empty epic index", () => {
		tree()
			.write("quest/a0/husk/README.md", "# Husk\n\n## Goal\n\nIts last quest was completed.\n\n## Required\n")
			.append("quest/a0/README.md", "- [Husk](/quest/a0/husk/README.md)\n")
			.rejects("'## Required' is empty");
	});

	// The absence of `## Required` means ready. A heading left behind by its last
	// blocker reads as blocked to every readiness check, forever.
	test("an empty Required section", () => {
		tree().append("quest/a0/epic/one.md", "\n## Required\n").rejects("'## Required' is empty");
	});

	test("an unlisted quest", () => {
		tree()
			.write("quest/a0/epic/three.md", "# [S] Three\n\n## Goal\n\nA quest nobody indexed.\n")
			.rejects("not listed in quest/a0/epic/README.md's '## Required'");
	});

	// Children are the entries that sit directly under the epic, so an act
	// requiring a grandchild only waits on it; the epic still owns it.
	test("requiring a grandchild is a blocker", () => {
		const t = tree().append("quest/a0/README.md", "- [One](/quest/a0/epic/one.md)\n");
		t.accepts();
		expect(t.ready()).toEqual(["quest/a0/epic/one.md"]);
	});

	test("a quest listed twice", () => {
		tree()
			.append("quest/a0/epic/README.md", "- [One again](/quest/a0/epic/one.md)\n")
			.rejects("requires /quest/a0/epic/one.md twice");
	});

	test("a relative index entry", () => {
		tree()
			.write("quest/a0/epic/README.md", EPIC_README.replace("(/quest/a0/epic/one.md)", "(one.md)"))
			.rejects("link to a quest must be root-absolute: one.md");
	});

	// A target that merely exists is not enough: quest/AGENTS.md is a file under
	// quest/ that nothing can finish.
	test("an index entry that is not a quest", () => {
		tree()
			.write("quest/AGENTS.md", "# Contract\n")
			.append("quest/README.md", "- [Contract](/quest/AGENTS.md)\n")
			.rejects("requires /quest/AGENTS.md, which is not a quest document");
	});

	// The index is a list of entries, not prose that happens to link.
	test("prose under the index", () => {
		tree().append("quest/a0/epic/README.md", "\nSee also [One](/quest/a0/epic/one.md).\n").rejects("mid-sentence");
	});

	// A blocker outside the epic's directory is not a child, so a README holding
	// only one is a quest and needs a size like any other.
	test("an epic listing no quest", () => {
		tree()
			.write(
				"quest/a0/husk/README.md",
				"# Husk\n\n## Goal\n\nIts last quest was completed.\n\n## Required\n\n- [One](/quest/a0/epic/one.md)\n",
			)
			.append("quest/a0/README.md", "- [Husk](/quest/a0/husk/README.md)\n")
			.rejects("quest title must be");
	});

	// A LOOSE list - blank lines between entries - wraps every item in a
	// paragraph. Treating that paragraph as text would classify every entry in
	// the list as mid-sentence prose, which is a false positive on ordinary
	// Markdown and would fire on every blocker and every index entry at once.
	test("a loose index list", () => {
		tree()
			.write(
				"quest/a0/epic/README.md",
				"# Epic\n\n## Goal\n\nAn epic.\n\n## Required\n\n- [One](/quest/a0/epic/one.md)\n\n- [Two](/quest/a0/epic/two.md)\n",
			)
			.accepts();
	});

	// An act with nothing left is not its own work, so it needs no size and
	// never lists as ready.
	test("an act may be empty", () => {
		const t = tree().write("quest/a0/README.md", "# a0\n\n## Goal\n\nEmpty for now.\n").remove("quest/a0/epic");
		t.accepts();
		expect(t.ready()).toEqual([]);
	});
});

describe("Required", () => {
	test("a direct cycle", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Required\n\n- [Two](/quest/a0/epic/two.md) - must finish first\n")
			.rejects("Required cycle:");
	});

	// A quest may require a whole epic, so the deadlock can span the
	// README. The cycle here runs strictly OUTSIDE-IN: `outer` (in a0) requires
	// the epic, and `three` inside that epic requires `outer`
	// back. No quest requires its own epic, so containment edges are the
	// only thing that can close it.
	test("a cycle through an epic", () => {
		tree()
			.append("quest/a0/README.md", "- [Outer](/quest/a0/outer.md)\n")
			.write(
				"quest/a0/outer.md",
				"# [S] Outer\n\n## Goal\n\nBlocked on a whole epic.\n\n## Required\n\n- [Epic](/quest/a0/epic/README.md) - the whole epic must finish\n",
			)
			.append("quest/a0/epic/README.md", "- [Three](/quest/a0/epic/three.md)\n")
			.write(
				"quest/a0/epic/three.md",
				"# [S] Three\n\n## Goal\n\nInside the epic that blocks it.\n\n## Required\n\n- [Outer](/quest/a0/outer.md) - must finish first\n",
			)
			.rejects(
				"Required cycle: quest/a0/epic/README.md -> quest/a0/epic/three.md -> quest/a0/outer.md -> quest/a0/epic/README.md",
			);
	});

	// A `#fragment` addresses a place inside a file, not a different file.
	// Keeping it on made a phantom graph node that no quest could match, so a
	// cycle through an anchored link went unreported.
	test("a cycle through an anchored link", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- [Two](/quest/a0/epic/two.md#plan) - must finish first\n",
			)
			.rejects("Required cycle:");
	});

	// Reference-style links render as real dependencies, so they must carry real
	// edges. A line-oriented parser saw no `](` here and produced none.
	test("a cycle through a reference-style link", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- [Two][two] - must finish first\n\n[two]: /quest/a0/epic/two.md\n",
			)
			.rejects("Required cycle:");
	});

	// The index and the cycle walk key on the same normalized path. A `..` left
	// in either makes a node nothing can match, so the cycle through it
	// disappears.
	test("a cycle through an unnormalized link", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- [Two](/quest/a0/epic/../epic/two.md) - must finish first\n",
			)
			.rejects("Required cycle:");
	});

	// moq-dev/moq.pro#1170: a customer-gate sentence that happens to link an
	// epic mid-sentence reads as context but IS a dependency edge.
	test("a link mid-sentence", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- A customer who also justifies [the epic](/quest/a0/epic/README.md).\n",
			)
			.rejects("mid-sentence");
	});

	// The same failure, reflowed onto a second line. The link is no longer on the
	// bullet's first line, which is all it took to slip past the shell version.
	test("a link on a wrapped bullet", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- A customer who also justifies\n  [the epic](/quest/a0/epic/README.md).\n",
			)
			.rejects("mid-sentence");
	});

	// An outside condition is its own quest, so it keeps surfacing as ready
	// instead of hiding the quest it blocks from every ready listing. The bullet
	// wraps here because that is what such bullets in trees actually looked like.
	test("an external condition", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Required\n\n- A `moq-video` release that carries\n  the encoder\n")
			.rejects("requires A moq-video release that carries the encoder, which is not a quest document");
	});

	// An issue or release link is outside the tree too; only a quest can clear.
	test("an external link", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- [#1](https://github.com/OWNER/REPO/issues/1) - upstream fix\n",
			)
			.rejects("requires https://github.com/OWNER/REPO/issues/1, which is not a quest document");
	});

	test("a loose Required list", () => {
		const t = tree().append(
			"quest/a0/epic/one.md",
			"\n## Required\n\n- [Two](/quest/a0/epic/two.md) - must finish first\n\n- [Epic](/quest/a0/epic/README.md) - the whole epic\n",
		);
		// Both edges registered (hence the cycle) without reading as prose.
		t.rejects("Required cycle:");
		t.without("mid-sentence");
	});

	// The other side of the same seam: a link opening a SECOND paragraph is
	// inside the item, not opening it.
	test("a link in a later paragraph", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- A customer who justifies the work.\n\n  [The epic](/quest/a0/epic/README.md) would follow.\n",
			)
			.rejects("mid-sentence");
	});

	// A blocker written with emphasis still opens its bullet. Rejecting it would
	// be a false positive on legitimate Markdown.
	test("a link with emphasis", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Required\n\n- **[Two](/quest/a0/epic/two.md)** - must finish first\n")
			.rejects("Required cycle:");
	});

	// A bullet nested under a prose lead-in is illustration, not a blocker.
	// Reading it as one is #1170 again, wearing an indent.
	test("a nested entry", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- Customer evidence:\n  - [The epic](/quest/a0/epic/README.md)\n",
			)
			.rejects("mid-sentence");
	});

	test("a blockquoted entry", () => {
		tree()
			.append(
				"quest/a0/epic/one.md",
				"\n## Required\n\n- Quoting the old plan:\n\n  > - [The epic](/quest/a0/epic/README.md)\n",
			)
			.rejects("mid-sentence");
	});
});

// Readiness: what `quest ready` reports about the same fixture. A blocker list
// is the machine-readable result, so the cases that must come back EMPTY carry
// as much weight as the ones that must not.
describe("ready", () => {
	/** The absence of `## Required` is the whole definition of ready. */
	test("a ready quest has no blockers", () => {
		expect(tree().blockers("quest/a0/epic/one.md")).toEqual([]);
	});

	test("blocked by a quest", () => {
		expect(tree().blockers("quest/a0/epic/two.md")).toEqual(["quest/a0/epic/one.md"]);
	});

	// An epic blocker clears only when the whole epic is complete, so the
	// useful answer is which of its quests are still open - all of them, since a
	// completed quest is deleted.
	test("blocked by an epic", () => {
		const t = tree()
			.append("quest/a0/README.md", "- [Outer](/quest/a0/outer.md)\n")
			.write(
				"quest/a0/outer.md",
				"# [S] Outer\n\n## Goal\n\nBlocked on a whole epic.\n\n## Required\n\n- [Epic](/quest/a0/epic/README.md) - the whole epic must finish\n",
			);
		expect(t.blockers("quest/a0/outer.md")).toEqual([
			"quest/a0/epic/README.md",
			"  quest/a0/epic/one.md",
			"  quest/a0/epic/two.md",
		]);
	});

	// A required QUEST does not expand: its own blockers are its readiness, and
	// running this on it is how you ask. Expanding buried the entries that were
	// asked for under a subtree repeated once per path through it.
	test("a required quest is not expanded", () => {
		const t = tree()
			.append("quest/a0/epic/README.md", "- [Three](/quest/a0/epic/three.md)\n")
			.write(
				"quest/a0/epic/three.md",
				"# [S] Three\n\n## Goal\n\nLast in the chain.\n\n## Required\n\n- [Two](/quest/a0/epic/two.md) - must finish first\n",
			);
		expect(t.blockers("quest/a0/epic/three.md")).toEqual(["quest/a0/epic/two.md"]);
	});

	// `quest check` reports an empty `## Required` as a defect, and every reader
	// that greps for the heading calls the quest blocked. Reading it as ready
	// here would make this the one tool that disagrees.
	test("an empty Required section still blocks", () => {
		const t = tree().append("quest/a0/epic/one.md", "\n## Required\n");
		expect(t.blockers("quest/a0/epic/one.md")).toEqual([
			"an empty '## Required' section, which blocks the quest until the heading is removed",
		]);
	});

	// The listing is the query the start flow reproduces by grepping. An
	// epic is absent while it still indexes children, and `two.md` is
	// blocked.
	test("the listing", () => {
		const t = tree();
		expect(t.ready()).toEqual(["quest/a0/epic/one.md"]);
		t.append("quest/a0/README.md", "- [Outer](/quest/a0/outer.md)\n").write(
			"quest/a0/outer.md",
			"# [S] Outer\n\n## Goal\n\nReady too.\n",
		);
		expect(t.ready()).toEqual(["quest/a0/epic/one.md", "quest/a0/outer.md"]);
	});

	// `quest check` proves the graph acyclic, but readiness also runs on trees
	// nobody has checked yet - the branch that just introduced the cycle - and a
	// cycle there has to print rather than recurse forever.
	test("a cycle terminates", () => {
		const t = tree()
			.append("quest/a0/epic/README.md", "- [Itself](/quest/a0/epic/README.md)\n")
			.append("quest/a0/README.md", "- [Outer](/quest/a0/outer.md)\n")
			.write(
				"quest/a0/outer.md",
				"# [S] Outer\n\n## Goal\n\nBlocked on an epic that lists itself.\n\n## Required\n\n- [Epic](/quest/a0/epic/README.md) - the whole epic must finish\n",
			);
		expect(t.blockers("quest/a0/outer.md")).toEqual([
			"quest/a0/epic/README.md",
			"  quest/a0/epic/one.md",
			"  quest/a0/epic/two.md",
			"  quest/a0/epic/README.md",
		]);
	});

	test("the listing follows nested priority and terminates cycles", () => {
		const t = tree()
			.write("quest/a0/epic/two.md", "# [S] Two\n\n## Goal\n\nReady.\n")
			.write(
				"quest/a0/epic/README.md",
				"# Epic\n\n## Required\n\n- [Two](/quest/a0/epic/two.md)\n- [Self](/quest/a0/epic/README.md)\n- [One](/quest/a0/epic/one.md)\n",
			);
		expect(t.ready()).toEqual(["quest/a0/epic/two.md", "quest/a0/epic/one.md"]);
	});

	test("the listing appends unindexed quests", () => {
		const t = tree()
			.write("quest/a0/aaa.md", "# [S] Unindexed\n\n## Goal\n\nDiscover me.\n")
			.write(
				"quest/a0/blocked.md",
				"# [S] Blocked\n\n## Goal\n\nWait.\n\n## Required\n\n- [One](/quest/a0/epic/one.md)\n",
			);
		expect(t.ready()).toEqual(["quest/a0/epic/one.md", "quest/a0/aaa.md"]);
	});
});

// Shapes the Rust parser handled that a plain CommonMark port would not. Each
// was found by running both implementations over the same documents.
describe("parser parity", () => {
	// Blank text renders as nothing, so it does not displace an opening link.
	test.each(["&nbsp;", "` ` "])("a link after blank text still opens its entry: %j", (lead) => {
		tree()
			.append("quest/a0/epic/one.md", `\n## Required\n\n- ${lead}[Two](/quest/a0/epic/two.md)\n`)
			.rejects("Required cycle:");
	});

	test("a struck-through heading is the heading, and not literal", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## ~~Required~~\n\n- [Two](/quest/a0/epic/two.md)\n")
			.rejects("'Required' must be written literally");
	});

	test("struck-through blocker text renders without its markers", () => {
		const t = tree().append("quest/a0/epic/one.md", "\n## Required\n\n- ~~Old~~ plain blocker\n");
		expect(t.blockers("quest/a0/epic/one.md")).toEqual(["Old plain blocker"]);
	});

	test("a link in a table cell does not open its entry", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Required\n\n- [Two](/quest/a0/epic/two.md) | note\n  --- | ---\n")
			.rejects("mid-sentence");
	});

	test("a wrapped setext heading reads as one line", () => {
		const t = tree().append("quest/a0/epic/one.md", "\nRe\nquired\n--------\n\n- [Two](/quest/a0/epic/two.md)\n");
		t.rejects("'Required' must be written literally");
		expect(t.findings().every((f) => !f.includes("\n"))).toBe(true);
	});

	// `//host/path` is protocol-relative on GitHub, not a file in this tree.
	test("a protocol-relative link does not resolve", () => {
		tree()
			.append("quest/a0/epic/one.md", "\n## Related\n\n- [Two](//quest/a0/epic/two.md) - same file, wrong link\n")
			.rejects("link does not resolve: //quest/a0/epic/two.md");
	});

	// grep sees a CR-only file as one line, so `^## Required$` matches nothing
	// in it; the literal-heading rule has to agree.
	test("a CR-only document's headings are not literal", () => {
		const t = tree();
		t.write("quest/a0/epic/two.md", t.read("quest/a0/epic/two.md").replaceAll("\n", "\r"));
		t.rejects("'Required' must be written literally");
	});
});

// Intended changes from the Rust parser, listed in the TypeScript port's PR.
describe("parser changes", () => {
	test("blocker text separates the blocks it spans", () => {
		const t = tree().append(
			"quest/a0/epic/one.md",
			"\n## Required\n\n- Customer evidence:\n  - [The epic](/quest/a0/epic/README.md)\n",
		);
		expect(t.blockers("quest/a0/epic/one.md")).toEqual(["Customer evidence: The epic"]);
	});

	test("an email autolink is skipped like mailto:", () => {
		tree().append("quest/a0/epic/one.md", "\nWrite to <a@b.c>.\n").accepts();
	});
});
