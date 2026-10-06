# Quest log theme

## Goal

By the 2026-10-14 Cloudflare demo, Quest presents itself as an original
MMO-style quest log for your repository and your agents: themed README and
docs copy, a shared identity (logo, palette, social image), a themed site at
`https://kixel.quest` (home, docs, and quest board), and themed CLI output on
a terminal. The quest format, `quest guide`, and the skills do not change.

This README owns the work no child does: a final pass over every surface for
consistency with `docs/theme.md` before the demo is recorded.

## Plan

Decided while planning on 2026-10-05:

- Original homage, not a WoW parody. Use only genre conventions (`!` and `?`
  markers, quest log windows, gold borders, difficulty colours). No Blizzard
  names, art, fonts, icons, or screenshots.
- Flavour over the contract. The format's terms (quest, questline, milestone,
  `Required`, `[XS]`-`[XL]`) stay as they are because agents and `quest check`
  rely on them. The theme lives in presentation only. A renamed format would
  break the guide, skills, and existing trees before v0.1.0.
- Hook, then substance. The headline and visuals sell "a quest log for your
  repo and your agents". The next lines deliver the existing pitch: readable
  plans, explicit dependencies, and reviewable Git changes.
- Land before the demo. Originality (50%) and ease of use (25%) dominate the
  competition judging, so the
  [Cloudflare questline](/quest/m0/cloudflare/README.md) records its demo after
  this line lands. Aim to merge by 2026-10-12.
- One display glossary is shared by every surface. No XP, levels,
  achievements, or leaderboards; they add state for little demo value.
- `docs/theme.md` is the human source of truth for the glossary, markers,
  colours, palette, type, and mark (`docs/theme/`). The CLI and the Worker
  each keep a small constant table that cites it. The roughly ten strings
  are cheap to duplicate, and this keeps presentation out of the Rust core
  that the Worker loads as wasm.
- The look is dark only. There is no light mode. On 2026-10-06 the
  "illuminated ledger" direction (warm ink, parchment text, gold leaf,
  Cormorant Garamond headings) replaced the slate window and Cinzel; see
  [Site](/quest/m0/theme/site.md).
- Lean into the RPG voice but stay semi-professional (decided 2026-10-06).
  Tokens are gold coins, visually ("Offer gold"), as display only.
- The site on the Worker (home, docs, and the hosted app under one shell)
  replaces launch.md's earlier "no website" boundary.

## Required

- [Site](/quest/m0/theme/site.md) - kixel.quest's refreshed identity, shared shell, home page, and rendered docs
- [Quest map](/quest/m0/theme/map.md) - the home page draws Quest's own tree as a left-to-right world map
- [Social preview](/quest/m0/theme/social-preview.md) - a maintainer uploads `docs/theme/og.png` as the GitHub social preview
- [Copy](/quest/m0/theme/copy.md) - the README, docs, and GitHub repository metadata in the quest-log voice
- [Themed CLI output](/quest/m0/theme/cli.md) - `!`/`?` markers and difficulty colours on a terminal; piped output unchanged
- [Landing page](/quest/m0/theme/landing.md) - the home page's map and calls to action link into the live board

## Related

- [Quest board](/quest/m0/cloudflare/board.md) - built themed from the start, using the identity
- [Launch material](/quest/m0/launch.md) - posts, quickstart, demo, and comparison written in the same voice
