# [L] Design and build kixel.quest

## Goal

`https://kixel.quest` is one designed site. The home page, the docs, and the
hosted app (board, changes, sign-in) share a refreshed quest-log identity and
one site shell. It lands by 2026-10-12, ahead of the 2026-10-14 demo.

- Identity: `docs/theme.md`, `docs/theme/theme.css`, the mark, and `og.png`
  move to the "illuminated ledger" direction: warm ink backdrop, parchment
  text, gold-leaf accents, Cormorant Garamond headings with Inter body, an
  ornamental divider, and quests drawn as ledger pages with a drop cap.
- Shell: one Hono JSX layout (nav, footer, type, tokens) used by every page
  the Worker serves, including the existing sign-in pages.
- Home: the hook and the one-line setup paste, then sections for: everything
  is a file (plans agents can discover), coordinating agents through git, a
  sample quest as Markdown beside its rendered ledger page, how it works (plan
  with your agent, run, review and merge), long-term plans as a map, and
  joining the party (contributors claim quests and offer gold). The
  long-term plans section holds a static placeholder until
  [Quest map](/quest/m0/theme/map.md) fills it.
- Docs: `docs/*.md` rendered into pages under `/docs` at build time.

## Plan

Decided while planning on 2026-10-06:

- One quest, not an identity quest followed by a site quest. The user accepted
  that the CLI and copy quests see the new tokens only once this lands.
- The map is split into [Quest map](/quest/m0/theme/map.md), because it needs
  the wasm core (still a draft) and the design shouldn't wait for it.
- Direction B, "illuminated ledger", was chosen over refining today's slate
  window (A) and a modern dev-tool look (C, Space Grotesk and monospace with
  gold as the only accent). It replaces the theme questline's slate panels
  and Cinzel.
- Lean into the RPG voice but stay semi-professional: ledger, party, gold,
  and chapters, yes; pixel art, sound, and game UI chrome, no.
- The mark and the web difficulty colours are left to the implementer's eye,
  since the user delegated both. By default, keep the shield and `!` shape
  recoloured to ink and gold leaf. Keep the five hues and the terminal SGR
  codes, and retune only the web hex values so each passes AA on the new
  surfaces. Record whatever is chosen in `docs/theme.md`.
- Tokens are gold coins, visually: donated agent tokens and a run's spend
  show as gold with a coin glyph, and funding a quest reads "Offer gold". This
  is display only. There is no pledge pool and no new state, and the no-XP
  rule stands. Add these terms to the glossary.
- Served by the same Worker in `cloudflare/`: static assets plus the shared
  layout, so there is one deploy and one origin for sign-in. The PR targets
  the Cloudflare questline's branch, where the Worker lives.
- Docs render from the repository's Markdown so the repo stays the single
  source and GitHub links keep working. Keep the `/setup` short link.
- The home page's live wiring (map nodes linking to board pages, sign-in and
  onboarding calls to action) belongs to
  [Landing page](/quest/m0/theme/landing.md).
- The board can start before this lands. Whichever of the two lands second
  moves the board onto the shared layout.
- Re-export `og.png` from the new `og.svg`, then
  [Social preview](/quest/m0/theme/social-preview.md) uploads it.

## Related

- [Quest map](/quest/m0/theme/map.md) - fills the home page's long-term plans section
- [Quest board](/quest/m0/cloudflare/board.md) - the hosted app's main page, which moves onto the same shell
- [Landing page](/quest/m0/theme/landing.md) - wires the home page to the live board
