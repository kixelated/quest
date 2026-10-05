# [S] Rewrite the README and docs in the quest-log voice

## Goal

The README opens with the logo and the hook, "a quest log for your repo and
your agents", then delivers the substance: readable plans, explicit
dependencies, and reviewable Git changes. `docs/getting-started.md` and
`cloudflare/README.md` (where it exists) use the glossary in `docs/theme.md`.
The GitHub repository has a description, topics, and a homepage link.

## Plan

- Hook, then substance: the theme gets attention and the existing pitch earns
  trust. Keep the format's real terms wherever a reader must type or match them
  (headings in quest files, CLI commands). Use glossary names in prose only.
- README examples must stay consistent with real CLI output. They show the
  piped (plain) form unless [Themed CLI output](/quest/m0/theme/cli.md) has
  landed, in which case terminal examples show what a terminal prints.
- Do not edit `CONTRIBUTING.md`, `PROMPTING.md`, `assets/AGENTS.md`, or the
  skills (AGENTS.md); the agent-facing contract stays plain.
- Setting the repository description, topics, and homepage is a maintainer
  action on GitHub; propose the values in the PR.
