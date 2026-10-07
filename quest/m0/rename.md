# [M] Rename milestones to chapters and questlines to epics

## Goal

The format uses one set of terms everywhere (`quest guide`, the skills, CLI
output, README, docs, the site, and the quest tree) and they fit the
quest-log voice, so no surface needs display-name aliases. A milestone becomes
a **chapter**, a questline becomes an **epic**, and the root directories `m0`,
`m1`, ... become `c0`, `c1`, .... Every other term stays: quest, `Goal`,
`Plan`, `Required`, `Closes`, `Related`, sizes, and claims. It lands before
the 2026-10-14 demo.

## Plan

Decided while planning on 2026-10-07:

- This reverses the theme epic's 2026-10-05 decision that the format's terms
  stay as they are. The user wanted consistent terms over display aliases.
  #69 had just made the README use the format's terms throughout.
- "Chapter" was already the site's display name for a milestone, and it
  reads as an ordered horizon (chapter 0, chapter 1). "Epic" replaces
  "questline" for a directory of quests with a `README.md`. In agile, an epic
  means a group of related work, which matches.
- Rename the directories too (`quest/m0` to `quest/c0`, and so on), so `m`
  doesn't linger as an alias. Quest paths and branch names change with them.
  The core treats the root's entries by position, not by name, so no logic
  changes. Check for any `m0`-shaped examples or fixtures in tests and
  `examples/`.
- The user authorized editing `assets/AGENTS.md` (the guide) and
  `assets/skills/` for this rename. Change terms only, not the workflow.
- Update in the same PR: README, `docs/`, `docs/theme.md`'s glossary (drop
  the alias table, since the terms are now the same), the site's copy and
  tests (`cloudflare/src/`), CLI messages and help, every quest file, and
  every root-absolute quest link.
- Open PRs that touch `quest/m0/...` (Cloudflare #40-#43) rebase onto the new
  paths when they next iterate. List them in the PR.
- Land it before the theme epic's final consistency pass and the demo
  recording, so both show the final vocabulary.

## Related

- [Quest log theme](/quest/m0/theme/README.md) - its glossary and final consistency pass follow this rename
- [Move the theme spec to design/](/quest/m0/theme/design-dir.md) - also edits `docs/theme.md`; whichever lands second merges
