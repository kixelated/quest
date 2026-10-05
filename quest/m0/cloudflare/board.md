# [L] Build the quest board

## Goal

Anyone can browse a project's quest tree and read its quests rendered. They
see what is ready, blocked (and by what), or claimed (and by whom), plus open
changes and issues. A signed-in contributor can start funding a ready quest
from its page. A maintainer can release claims and promote issues.

## Plan

- Readiness comes from the wasm core, run over the tree read from Artifacts.
- This is the main surface for the demo, so ease of use counts for 25% of the
  judging.
- Build it themed from the start, not restyled later (decided 2026-10-05 in
  [the theme questline](/quest/m0/theme/README.md)). It looks like a dark
  in-game quest log, and every status uses the glossary in `docs/theme.md`:
  a yellow `!` for ready, a grey `!` with "Requires" for blocked, "Accepted by"
  for claimed, a yellow `?` for an open change, difficulty colours for sizes,
  and Objectives and Rewards for `Goal` and `Closes`.

## Required

- [Worker scaffold](/quest/m0/cloudflare/scaffold.md) - the app it lives in
- [Core as wasm](/quest/m0/cloudflare/wasm.md) - check and ready in the Worker
- [Identity](/quest/m0/theme/identity.md) - the palette, marks, and glossary the board renders
