# [M] Resolve quest-list conflicts with a merge driver

## Goal

A local `git merge` resolves concurrent edits to a quest's link lists
(`Required`, `Related`, `Closes`) without conflict markers: links either side
added are kept, links either side removed stay removed, and anything that is
not a pure link-list edit still conflicts as usual. Repositories get the
driver from `quest init` with no per-repository wiring.

## Plan

Decided 2026-10-23 (user), from a replay of 280 merges of `main` into PR
branches in moq-dev/moq since 2026-09-23: 128 conflicted, and 29 of those
conflicted only in quest files, 26 of them in milestone `Required` lists
(`quest/m1/README.md` has 88 entries). The usual shape is `main` deleting
finished quests' lines while a branch inserts a new quest next to them.

- **Name (user):** `quest resolve %O %A %B %P`, registered as
  `merge.quest.driver`. Rejected: `reconcile` and `merge-file`.
- **Three-way list merge, not union.** Git's built-in `merge=union` was
  rejected after the same replay: in nearly every one of 47 resolved merges it
  kept lines for quests `main` had already deleted, because it concatenates
  both sides of a hunk. Inside a conflicting link list, keep base items that
  neither side removed, add items either side inserted, and order inserts by
  their position on each side (ours before theirs at the same rank). It reads
  only the three file versions, never the worktree.
- **Fail closed.** A conflict hunk that edits prose, changes an existing
  item's text on both sides, or spans outside a link list is written with
  standard conflict markers and the driver exits non-zero, so git reports the
  conflict as it does today.
- **Registration (user):** `quest init` writes `quest/** merge=quest` to
  `.gitattributes` and sets `merge.quest.driver` in the clone's local git
  config. Any other `quest` command adds the config line when it is missing,
  so fresh clones, worktrees, and new agents get it without a dev-shell hook.
  `quest uninstall` removes both. Git ignores drivers named only in
  `.gitattributes`, and GitHub's own merges ignore drivers entirely, so a PR
  still shows as conflicting until a local merge from its base is pushed.
- Update the guide's "Merge conflicts are expected" line to say list
  conflicts resolve themselves and only prose conflicts need aligning.
