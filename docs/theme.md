# Quest log theme

Quest presents itself as an original quest log for your repository and your
agents. This page is the source of truth for that presentation: the display
glossary, status markers, difficulty colours, palette, type, and mark. The
board, landing page, CLI, and copy keep small tables that cite it.

The theme is presentation only. Quest files, `quest check`, `quest guide`, and
the skills keep the format's own terms. Its files live in `docs/theme/`, not
`assets/`, which holds the agent contract embedded in the binary.

## Rules

- Original homage, not a parody. Use only genre conventions: `!` and `?`
  markers, quest log windows, gold borders, and difficulty colours. Use no
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
| questline | quest chain | |
| milestone | chapter | |
| `Goal` | Objectives | |
| `Closes` | Rewards | |
| contributors who donate tokens | the party | |

A quest shows its most advanced state: Ready to turn in, then Accepted by, then
Available or Requires.

## Difficulty

A quest's size is its difficulty. Show the size label next to its colour.

| Size | Colour | Hex | Terminal SGR | Extra |
| --- | --- | --- | --- | --- |
| XS | grey | `#9aa1ab` | `90` | |
| S | green | `#5ccf5c` | `32` | |
| M | yellow | `#f2d23c` | `33` | |
| L | orange | `#ff9838` | `38;5;208` | |
| XL | red | `#ff5f52` | `31` | "Elite" tag |

Markers use the same hues: yellow (`#f2d23c`, SGR `33`) for `!` Available and
`?` Ready to turn in, and grey (`#9aa1ab`, SGR `90`) for a blocked `!`.
Terminal colours are SGR codes so they follow the user's terminal palette:
named ANSI colours, plus 256-colour `208` for L and bright black `90` for XS
and blocked.

## Palette

An in-game window: slate panels, gold borders, and serif headings.
[`theme/theme.css`](theme/theme.css) defines these as `--ql-*` custom
properties.

| Token | Hex | Use |
| --- | --- | --- |
| `--ql-bg` | `#0e1218` | page backdrop |
| `--ql-panel` | `#19202a` | window panels |
| `--ql-raised` | `#232c38` | selected rows, insets |
| `--ql-rule` | `#313c4a` | dividers |
| `--ql-gold` | `#d9ac48` | window borders |
| `--ql-gold-dim` | `#8d6b22` | inner trim |
| `--ql-gold-bright` | `#f5c542` | headings |
| `--ql-text` | `#ebe4d2` | body text |
| `--ql-muted` | `#a9a394` | secondary text |
| `--ql-link` | `#8fc3f2` | links |
| `--ql-grey` | `#9aa1ab` | XS, blocked marker |
| `--ql-green` | `#5ccf5c` | S |
| `--ql-yellow` | `#f2d23c` | M, Available and Ready to turn in markers |
| `--ql-orange` | `#ff9838` | L |
| `--ql-red` | `#ff5f52` | XL, Elite tag |

Every text colour meets WCAG AA (4.5:1) on `--ql-bg`, `--ql-panel`, and
`--ql-raised`. The lowest is red on `--ql-raised`, at 4.7:1.

## Type

- Headings: [Cinzel](https://fonts.google.com/specimen/Cinzel), weight 700.
- Body: [Inter](https://fonts.google.com/specimen/Inter), weights 400 and 600.
- Code: the system monospace font.

Both fonts use the SIL Open Font License 1.1. Load them from Google Fonts;
do not commit font files. `theme.css` has the fallback stacks.

## Mark

[`theme/logo.svg`](theme/logo.svg) is a gold `!` on a slate shield. It carries
its own dark fill, so it reads on light pages too, and it stays legible at
16 px for favicons. Use it as is: do not recolour it, add text inside it, or
pair it with game art.

## Social image

[`theme/og.svg`](theme/og.svg) is the source and
[`theme/og.png`](theme/og.png) the 1280 by 640 export. The SVG imports
Cinzel and Inter from Google Fonts, so export it with network access:

```sh
google-chrome --headless=new --hide-scrollbars --virtual-time-budget=10000 \
  --window-size=1280,640 --screenshot=docs/theme/og.png \
  "file://$PWD/docs/theme/og.svg"
```

A maintainer uploads `og.png` by hand under the repository's Settings, General,
Social preview.
