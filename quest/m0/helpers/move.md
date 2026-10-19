# [M] Move and delete quests with quest mv and quest rm

## Goal

`quest mv <from> <to>` and `quest rm <path>` move or delete a quest or epic
and keep every root-absolute link in the tree valid. Agents stop following
`git rm` and `git mv` with `grep -r` and `sed -i` over Required links (203
sessions since Oct 14). `quest check` already finds the broken links; these
commands avoid making them.

## Plan

- Decided 2026-10-19 (user): run `git mv` and `git rm`, so the change is
  staged. Fail outside a git work tree rather than falling back to plain
  file operations.
- `mv` rewrites every link to the moved path under `quest/`; moving an epic
  directory rewrites links under it as a prefix. Moving a quest into or out
  of an epic changes its structural membership; `quest check` reports what
  the epic's Required still needs rather than `mv` guessing.
- `rm` drops list items that link to the deleted path (or under a deleted
  epic) and deletes a section left empty, as the guide requires for an empty
  Required. Removing an epic with children requires `-r`, as with `git rm`.
- Both report prose mentions of the path and mentions outside `quest/`
  without editing them, and run `quest check` on the result.
- Neither touches branches or PRs: a claimed quest's branch keeps its old
  name, and renaming an open PR's head branch closes the PR.
- Put the link rewriting in the core as a pure edit of documents; the CLI
  owns git. Update the `delete` and `audit` skills to use `quest rm` and
  `quest mv`.
- Test moving a quest, moving an epic, deleting a quest listed under several
  Required and Related sections, refusing a non-empty epic without `-r`, and
  a destination that already exists.
