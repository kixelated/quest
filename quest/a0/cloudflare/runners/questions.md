# [S] Add a questions section to the quest format

## Goal

A quest can carry `## Questions`: the decisions an agent needs from a
maintainer before it can continue. `quest check` validates it, `quest ready`
treats a quest with questions as blocked and prints them as the blocker, and
`quest guide` documents how agents add questions and how they are answered.

## Plan

- Decided 2026-10-07: questions live in the quest file, not in git notes, so
  `ready` sees the block and the answer ends up recorded in the Plan.
- Format: each question is a list item with context and a recommendation,
  followed by numbered options, exactly one marked `(recommended)`. Keep the
  check loose enough that the UI can render it as an interactive prompt.
- Agents that can't prompt (runners, background agents) end their work with a
  "blocked commit" that adds the section. The "unblock commit" moves each
  answer into `## Plan` with its reason and deletes the section.
- Update the guide's Questions section and the skills that hand decisions to
  maintainers. The user authorized editing `assets/` for this.
