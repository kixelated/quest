# [XS] Link the map's quests to their board pages

## Goal

Before the 2026-10-14 demo, every quest on the home page's map
(`cloudflare/src/map.tsx`) opens its board page (its `href`, such as
`/repos/quest/quest/a0/theme/map-links`) instead of the quest file on GitHub,
and each epic's title opens its epic page. The board's Markdown
(`board/markdown.ts`) and quest pages (`board/pages.tsx`) build GitHub file
links with one shared `blobHref(project, path)` helper beside `questHref` in
`board/model.ts`, and the map stops building them.

## Plan

Split from [Landing page](/quest/a0/theme/landing.md) on 2026-10-07. The
board's pages already read a build-time snapshot (kixelated/quest#74), so these
links don't need GitHub sync or onboarding. Only the landing page's calls to
action do. Quest's own tree on the board is the most convincing demo, so the
map's quests lead into it. The shared helper came from the map review
(kixelated/quest#78). The site's other `blob/main` links (`docs.tsx`,
`home.tsx`, `index.tsx`) don't use the board's `Project` and stay as they are.
