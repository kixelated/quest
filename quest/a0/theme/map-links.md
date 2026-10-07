# [XS] Link the map's quests to their board pages

## Goal

Before the 2026-10-14 demo, every quest on the home page's map
(`cloudflare/src/map.tsx`) opens its board page (`/repos/quest/<quest path>`)
instead of the quest file on GitHub. Epic links follow wherever the board has
an epic page. The map, the board's Markdown, and the board's pages build GitHub
file links with one shared `blobHref(project, path)` helper rather than three
separate builders.

## Plan

Split from [Landing page](/quest/a0/theme/landing.md) on 2026-10-07. The
board's pages already read a build-time snapshot (kixelated/quest#74), so these
links don't need GitHub sync or onboarding. Only the landing page's calls to
action do. The shared helper came from the map review (kixelated/quest#78).
