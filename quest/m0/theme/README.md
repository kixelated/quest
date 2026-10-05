# Quest log theme

## Goal

By the 2026-10-14 Cloudflare demo, Quest presents itself as an original
MMO-style quest log for your repository and your agents: themed README and
docs copy, a shared identity (logo, palette, social image), a themed quest
board and landing page, and themed CLI output on a terminal. The quest format,
`quest guide`, and the skills do not change.

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
- The look is dark only: an in-game window with slate panels, gold borders,
  and serif headings. There is no light mode.
- The landing page on the Worker replaces launch.md's earlier "no website"
  boundary.

## Required

- [Copy](/quest/m0/theme/copy.md) - the README, docs, and GitHub repository metadata in the quest-log voice
- [Themed CLI output](/quest/m0/theme/cli.md) - `!`/`?` markers and difficulty colours on a terminal; piped output unchanged
- [Landing page](/quest/m0/theme/landing.md) - the Worker's front page pitches Quest over its own live quest board

## Related

- [Quest board](/quest/m0/cloudflare/board.md) - built themed from the start, using the identity
- [Launch material](/quest/m0/launch.md) - posts, quickstart, demo, and comparison written in the same voice
