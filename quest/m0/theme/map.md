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
- Parse the tree with the shared TypeScript core, so its rules match
  `quest check`.
- Split from the site quest so the design wasn't blocked on the core's port
  to TypeScript. Draw into the home page's "Long-term plans, as a map"
  section (`id="map"` in `cloudflare/src/home.tsx`), replacing its static
  placeholder.
- Keep it readable over decorative: the RPG feel stays semi-professional, as
  the theme questline decided.
- Every status and size keeps its text label, since colour is never the only
  signal.

## Required

- [Port to TypeScript](/quest/m0/cloudflare/typescript.md) - the parser the build reuses
