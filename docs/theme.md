# Quest log theme

Quest presents itself as an original quest log for your repository and your
agents. This page is the source of truth for that presentation: the display
glossary, status markers, difficulty colours, palette, type, and mark. The
site, board, CLI, and copy keep small tables that cite it.

The theme is presentation only. Quest files, `quest check`, `quest guide`, and
the skills keep the format's own terms. Its files live in `docs/theme/`, not
`assets/`, which holds the agent contract embedded in the binary.

## Rules

- Original homage, not a parody. Use only genre conventions: `!` and `?`
  markers, quest log pages, gold borders, and difficulty colours. Use no
  Blizzard names, art, fonts, icons, or screenshots.
- Hand-written SVG and CSS, and open-licensed fonts only.
- Dark only. There is no light mode.
- Never use colour as the only signal. Every marker and difficulty colour comes
  with its text label.
- No XP, levels, achievements, or leaderboards.

## Voice

Hook, then substance. Lead with "a quest log for your repo and your agents",
then deliver the pitch: readable plans, explicit dependencies, and reviewable
Git changes.

Lean into the RPG voice but stay semi-professional: ledger, party, gold, and
acts, yes; pixel art, sound, and game interface chrome, no.

## Glossary

Use display names in prose and interfaces. Anything a reader must type or
match, such as quest headings, CLI commands, and `--help` text, keeps the
format term.

| Format term | Display | Marker |
| --- | --- | --- |
| ready | Available | yellow `!` |
| blocked | Requires: *titles* | grey `!` |
| claimed | Accepted by @*name* | |
| open PR or change | Ready to turn in | yellow `?` |
| merged | Quest complete | |
| `Goal` | Objectives | |
| `Closes` | Rewards | |
| contributors who donate tokens | the party | |
| agent tokens, donated or spent | gold | coin glyph |
| fund a quest | Offer gold | coin glyph |

A quest shows its most advanced state: Ready to turn in, then Accepted by, then
Available or Requires.

Gold is display only: a run's spend and donated tokens show as gold with a coin
glyph. There is no pledge pool and no new state.

## Difficulty

A quest's size is its difficulty. Show the size label next to its colour.

| Size | Colour | Hex | Terminal SGR | Extra |
| --- | --- | --- | --- | --- |
| XS | grey | `#a59f95` | `90` | |
| S | green | `#5ccf5c` | `32` | |
| M | yellow | `#f2d23c` | `33` | |
| L | orange | `#ff9838` | `38;5;208` | |
| XL | red | `#ff5f52` | `31` | "Elite" tag |

Markers use the same hues: yellow (`#f2d23c`, SGR `33`) for `!` Available and
`?` Ready to turn in, and grey (`#a59f95`, SGR `90`) for a blocked `!`.
The grey is warm so it sits on the ink surfaces; the other hues already pass AA
on them and are unchanged.
Terminal colours are SGR codes so they follow the user's terminal palette:
named ANSI colours, plus 256-colour `208` for L and bright black `90` for XS
and blocked. L has no 16-colour fallback: the 16-colour palette has no orange,
and every stand-in is too close to M's yellow or XL's red. The size label
already tells them apart.
Emit `38;5;208` without detecting terminal colour depth.

## Palette

An illuminated ledger: warm ink pages, parchment text, and gold-leaf trim.
[`theme/theme.css`](theme/theme.css) defines these as `--ql-*` custom
properties.

| Token | Hex | Use |
| --- | --- | --- |
| `--ql-bg` | `#14100b` | page backdrop, ink |
| `--ql-panel` | `#1d1711` | ledger pages |
| `--ql-raised` | `#2a2118` | selected rows, insets, inline code |
| `--ql-rule` | `#3d3125` | dividers, table rules |
| `--ql-gold` | `#c9a14a` | gold-leaf borders, the divider |
| `--ql-gold-dim` | `#7a6230` | inner trim, margin rules |
| `--ql-gold-bright` | `#e6c063` | headings, drop caps, gold amounts |
| `--ql-text` | `#ede1c6` | body text, parchment |
| `--ql-muted` | `#b2a487` | secondary text |
| `--ql-link` | `#9db9e8` | links, lapis |
| `--ql-grey` | `#a59f95` | XS, blocked marker |
| `--ql-green` | `#5ccf5c` | S |
| `--ql-yellow` | `#f2d23c` | M, Available and Ready to turn in markers |
| `--ql-orange` | `#ff9838` | L |
| `--ql-red` | `#ff5f52` | XL, Elite tag |

Every text colour meets WCAG AA (4.5:1) on `--ql-bg`, `--ql-panel`, and
`--ql-raised`. The lowest is red on `--ql-raised`, at 5.3:1.

## Type

- Headings: [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond),
  weight 700.
- Body: [Inter](https://fonts.google.com/specimen/Inter), weights 400 and 600.
- Code: the system monospace font.

Both fonts use the SIL Open Font License 1.1. Load them from Google Fonts;
do not commit font files. `theme.css` has the fallback stacks.

## Components

[`theme/theme.css`](theme/theme.css) also carries the shared pieces:

- Ledger page (`.ql-ledger`): an ink panel with a gold-leaf border, an inner
  trim, and a double margin rule down the left. Quests, docs, and code samples
  sit on ledger pages.
- Drop cap (`.ql-dropcap`): the first letter of a page's opening paragraph,
  three lines tall in gold Cormorant Garamond.
- Divider (`.ql-divider`): a gold rule broken by a lozenge between two dots.
  It separates sections.
- Markers, difficulty (`.ql-size`), the Elite tag, and gold amounts
  (`.ql-gold`), each with its text label.

## Mark

[`theme/logo.svg`](theme/logo.svg) is a gold-leaf `!` on an ink shield with a
gold border. It carries its own dark fill, so it reads on light pages too, and
it stays legible at 16 px for favicons. Use it as is: do not recolour it, add
text inside it, or pair it with game art.

## Social image

[`theme/og.svg`](theme/og.svg) is the source and
[`theme/og.png`](theme/og.png) the 1280 by 640 export. The SVG imports
Cormorant Garamond and Inter from Google Fonts, so export it with network
access:

```sh
google-chrome --headless=new --hide-scrollbars --virtual-time-budget=10000 \
  --window-size=1280,640 --screenshot=docs/theme/og.png \
  "file://$PWD/docs/theme/og.svg"
```

A maintainer uploads `og.png` by hand under the repository's Settings, General,
Social preview.
