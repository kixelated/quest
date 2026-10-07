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
- Decided: use the SGR codes in `design/theme.md`: `90` for XS and blocked,
  and `32`, `33`, `31`, and `35` for S to XL. If the CLI needs different
  codes, change `design/theme.md` first.
- Decided 2026-10-07: every size has a named 16-colour code, so there is no
  256-colour code and no colour-depth detection.
- Honour `NO_COLOR`. Without colour, glyphs and wording may stay.
- Keep the labels in a small table that cites `design/theme.md`, in `src/cli`,
  not in the shared core the Worker imports.
- Written after the port to TypeScript (decided 2026-10-06), so the theme is
  written once, in TypeScript.
- Update README terminal examples and `--help` text to match.
