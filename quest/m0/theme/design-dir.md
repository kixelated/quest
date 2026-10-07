# [S] Move the theme spec and assets to design/

## Goal

`https://kixel.quest/docs` shows only user-facing documentation. The theme's
design spec, `docs/theme.md`, moves to `design/theme.md`, and its assets in
`docs/theme/` (`logo.svg`, `theme.css`, `og.svg`, `og.png`) move to `design/theme/`.
The site still serves the assets at `/theme/`, and nothing links to the old
paths.

## Plan

Decided while planning on 2026-10-07:

- The site renders every `docs/*.md` at `/docs`, so the internal spec is
  published there. Moving the spec and its assets together keeps `docs/`
  for user docs only, rather than adding a skip list to the site build.
- Update `cloudflare/scripts/build.ts`, which copies `docs/theme/` to the
  site's `/theme/`, plus the README's logo path, `cloudflare/README.md`'s
  links, `cloudflare/src/` comments that cite `docs/theme.md`, the spec's own
  paths and export commands, the asset files' comments, and every other file
  that references either path (grep the whole repository for `docs/theme`).
- Ranked after the copy rewrite (#69, merged), which also touched the
  README's logo path.

## Related

- [Rename milestones and questlines](/quest/m0/rename.md) - also edits `docs/theme.md`; whichever lands second merges
