# Quest log theme

## Goal

Quest presents itself as an original
MMO-style quest log for your repository and your agents: themed README and
docs copy, a shared identity (logo, palette, social image), a themed site at
`https://kix.quest` (home, docs, and quest board), and themed CLI output on
a terminal. The quest format, `quest guide`, and the skills do not change
beyond the 2026-10-07 rename of questlines to epics.

This README owns the work no child does: a final pass over every surface for
consistency with `design/theme.md` before the demo is recorded.
The pass also renames the "difficulty" leftovers to "size": the Worker's
`Difficulty` component (`cloudflare/src/layout.tsx`, used by
`cloudflare/src/home.tsx` and `cloudflare/src/board/pages.tsx`), the board's
"weighted by difficulty" wording (`cloudflare/src/board/pages.tsx`,
`cloudflare/src/board/model.ts`, `cloudflare/test/board.test.ts`), and the
wording in this README's `Required` list.
It also replaces the display aliases on the board, the home page, and
`cloudflare/README.md` with format terms: Available and `?show=available`
become ready, the Requires status and filter become blocked, Accepted by
becomes active (an authorized live job), the Requires heading becomes `Required`, Ready to turn in
becomes in review, Quest complete becomes complete, and Objectives and Rewards
become `Goal` and `Closes`. It rewrites `design/theme.md`'s glossary and its
marker and palette notes to match, keeping only the flavour rows (the party,
gold, Offer gold). The social image already uses the format terms.
Decided 2026-10-07: the pass also pluralises `quest check`'s terminal
summary ("1 documents checked") and keeps the piped `quest: N documents ok`
contract unchanged.
Decided 2026-10-07: the pass also fixes the CLI's column alignment for wide
characters (CJK, emoji) in quest titles, whose widths count UTF-16 units
(from the #77 review). It is cosmetic and low priority.
Decided 2026-10-07: the pass also adds a note to the og export steps in
`design/theme.md`: headless Chrome can silently fall back to system fonts on
a cold font cache, so re-run the export if the fonts look wrong.

## Plan

Decided while planning on 2026-10-05:

- Original homage, not a WoW parody. Use only genre conventions (`!` and `?`
  markers, quest log windows, gold borders, size colours). No Blizzard
  names, art, fonts, icons, or screenshots.
- Flavour over the contract. The format's terms (quest, epic, milestone,
  `Required`, `[XS]`-`[XL]`) are the contract agents and `quest check` rely
  on, and the theme adds no display aliases for them. Amended 2026-10-07: the
  format itself renamed questline to epic before v0.1.0, so every surface
  uses one set of terms. Decided 2026-10-13: the root's horizons are
  milestones again; act (chosen 2026-10-07) read as confusing.
- Hook, then substance. The headline and visuals sell "a quest log for your
  repo and your agents". The next lines deliver the existing pitch: readable
  plans, explicit dependencies, and reviewable Git changes.
- Decided 2026-10-13: the competition and deadline no longer gate launch.
  Keep the visual identity, with the guided decision inbox as the primary
  signed-in surface and repository maps/settings secondary.
- Decided 2026-10-07: every surface (site, board, map, and CLI) names format
  concepts with the format's own terms: ready, blocked, and `Required`
  (claimed dropped 2026-10-07 with claims). There are no display aliases (Available, Requires, Accepted by,
  Objectives, Rewards). Markers, size colours, the voice, and the flavour
  (gold, the party) stay. The user weighed RPG replacements (unlocked/locked,
  accepted, Objective/Prerequisites) and kept the current terms. Renaming
  `## Required` to `## Requires` was considered and dropped, so `Required`
  stays.
- Decided 2026-10-07: a quest with an open PR is "in review" and a merged
  one is "complete", since the format has no term for either. The final
  pass renames the board's "Ready to turn in" to in review and "Quest
  complete" to complete, and `design/theme.md`'s glossary rows follow.
- No XP, levels, achievements, or leaderboards; they add state for little demo
  value.
- Decided 2026-10-07: README.md, `docs/getting-started.md`, and
  `cloudflare/README.md` use the format's own terms (quest, epic,
  milestone, ready, blocked, `Required`, `Goal`) with no display-name
  aliases. Their voice, hook, logo, and flavour (the party, gold) stay. The
  final pass aligns `design/theme.md`, which still lists copy among the glossary
  users.
- `design/theme.md` is the human source of truth for the glossary, markers,
  colours, palette, type, and mark (`design/theme/`). The CLI and the Worker
  each keep a small constant table that cites it. The roughly ten strings
  are cheap to duplicate, and this keeps presentation out of the shared core.
- The look is dark only. There is no light mode. On 2026-10-06 the
  "illuminated ledger" direction (warm ink, parchment text, gold leaf,
  Cormorant Garamond headings) replaced the slate window and Cinzel. It has
  landed in `design/theme.md` with the site's shared layout in
  `cloudflare/src/layout.tsx`.
- Lean into the RPG voice but stay semi-professional (decided 2026-10-06).
  Tokens are gold coins, visually ("Offer gold"), as display only.
- The site on the Worker (home, docs, and the hosted app under one shell)
  replaces launch.md's earlier "no website" boundary.
- Decided 2026-10-07: the size scale stays `[XS]`-`[XL]`, and quests are
  coloured by size on every surface (site, board, map, and CLI).
  `design/theme.md` calls these size and size colours, not difficulty, so
  there is a single name.
- Decided 2026-10-07: the size colours are XS grey, S green, M yellow, L red,
  and XL purple, replacing L orange and XL red. Every size now has a named
  ANSI colour (SGR `90`, `32`, `33`, `31`, `35`), so the CLI needs no
  256-colour code or colour-depth detection. The web hues pass WCAG AA on all
  three ink surfaces, and components use the `--ql-size-*` tokens, so a scale
  change is a token change in `design/theme/theme.css`.
- Decided 2026-10-07: XL quests have no "Elite" tag. Purple XL and its size
  label already stand out.
- Decided 2026-10-07 on the map's PR (kixelated/quest#78): the map already
  uses these terms. A blocked waypoint's tooltip lists what it needs under
  "Required:".

## Required

- [Landing page](/quest/m0/theme/landing.md) - the home page's calls to action lead to sign-in, onboarding, and the setup paste

## Related

- [Decision inbox](/quest/m0/kix/prompts.md) - the primary hosted workflow
- [Launch material](/quest/m0/launch.md) - posts, quickstart, demo, and comparison written in the same voice
