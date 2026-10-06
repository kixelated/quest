# [M] Draw the quest map

## Goal

The home page at `https://kixel.quest` shows Quest's own `quest/` tree as a
map, read left to right like a video game world map. Milestones (chapters)
are regions, questlines (quest chains) are paths, and quests are nodes marked
with their status and difficulty, in the identity from `docs/theme.md`. The map
is generated at build time, so every deploy shows the real tree. Until
[Landing page](/quest/m0/theme/landing.md) lands, nodes link to the quest
files on GitHub.

## Plan

Decided while planning on 2026-10-06:

- Built from the real tree rather than a hand-drawn illustration, so it is
  proof, never drifts, and needs no upkeep.
- Parse the tree with the wasm core instead of a second parser in TypeScript,
  so its rules match `quest check`.
- Split from [Site](/quest/m0/theme/site.md) so the design isn't blocked on
  the wasm core.
- Keep it readable over decorative: the RPG feel stays semi-professional, as
  the theme questline decided.
- Every status and size keeps its text label, since colour is never the only
  signal.

## Required

- [Site](/quest/m0/theme/site.md) - the home page section and identity the map draws into
- [Core as wasm](/quest/m0/cloudflare/wasm.md) - the parser the build reuses
