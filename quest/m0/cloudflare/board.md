# [M] Build the quest board

## Goal

Anyone can browse a project's quest tree and read its quests rendered. They
see what is ready, blocked (and by what), or claimed (and by whom), plus open
changes and issues. A signed-in contributor can start funding a ready quest
from its page. A maintainer can release claims and promote issues.

## Plan

- Readiness comes from the wasm core, run over the tree read from Artifacts.
- This is the main surface for the demo, so ease of use counts for 25% of the
  judging.

## Required

- [Core as wasm](/quest/m0/cloudflare/wasm.md) - check and ready in the Worker
