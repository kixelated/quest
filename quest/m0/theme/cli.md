# [M] Theme the CLI's terminal output

## Goal

When stdout is a terminal, `quest ready` lists ready quests with a yellow `!`,
their title, and their size in its difficulty colour. Blocked quests show a
grey `!` and their requirements. `check`, `init`, and `uninstall` speak in the
quest-log voice. Piped output stays byte-identical to today: the same stdout
data, exit codes, and contract described in `quest ready --help`.

## Plan

- Decided: themed stdout on a TTY, plain when piped. Agents and scripts read
  piped output, so tests must pin the plain form exactly and cover the TTY form
  separately.
- Decided: start from the SGR codes in `docs/theme.md` (named ANSI colours,
  `38;5;208` for L, and `90` for XS and blocked). If the CLI needs different
  codes, change `docs/theme.md` first.
- Honour `NO_COLOR`. Without colour, glyphs and wording may stay.
- Keep the labels in a small table that cites `docs/theme.md`, not in the core
  rules the Worker loads as wasm.
- Update README terminal examples and `--help` text to match.
