# Set up Quest

Instructions for a coding agent. A user pastes a line like
"Follow https://github.com/kixelated/quest/blob/main/SETUP.md to set up Quest here"
(or "... to remove Quest"). Work from the repository root and show the user
every file you changed before committing.

Quest is a CLI that carries its skills and guide. A repository pins the binary
with its own tool manager and keeps only one-line skill stubs and one reference
line in its root instructions.

## Install and pin

Pin the latest [release](https://github.com/kixelated/quest/releases) tag.
Releases ship binaries for macOS and Linux on arm64 and x64. If there is no
release yet, only a nix flake can pin Quest, to the latest commit on `main`,
which it builds from source; otherwise tell the user Quest has no release to
install yet and stop.

Use the tool manager the repository already has:

- **mise** (`mise.toml` or `.mise.toml`):
  `mise use github:kixelated/quest@<tag>`.
- **nix flake** (`flake.nix`): add the input
  `quest.url = "github:kixelated/quest/<tag-or-sha>"`, put
  `quest.packages.${system}.default` in the dev shell, and update `flake.lock`.
- **Neither:** ask the user before installing anything globally. With consent,
  run the release's shell installer,
  `curl -LsSf https://github.com/kixelated/quest/releases/download/<tag>/quest-installer.sh | sh`,
  which puts `quest` in `~/.local/bin` (set `QUEST_INSTALL_DIR` to change it)
  and edits no shell configuration. Tell the user this install is unpinned.

Confirm `quest --version` runs before continuing.

## Initialize

```sh
quest init
```

Init writes a stub per skill under `.claude/skills/` (linking `.agents/skills/`
to the same tree), creates `quest/README.md` when missing, and appends a line
starting with `Quests: ` to the root `AGENTS.md`, or `CLAUDE.md` when only that
exists. It prints each path it changed and is safe to rerun.

If init refuses, it names the conflicting path. Report it and ask the user how
to proceed; never delete or rename their files to get past it.

## Adapt the instructions

Read the root instructions with the new line in place:

- Make sure the agents the user runs load the file holding the `Quests: ` line.
  For example, Claude Code reads `CLAUDE.md` and may not read `AGENTS.md`.
- Reword the line to match the file's style if needed, keeping the `Quests: `
  prefix so `quest uninstall` can find it.
- Point out existing rules that overlap with Quest, such as a planning doc, a
  TODO list, or rules about tracking work in issues. Propose how to reconcile
  them and let the user decide; do not rewrite them unasked.
- If `quest/README.md` was just created, ask the user what the project is
  working toward and write that as its Goal.

Run `quest check`, then suggest next steps: restart the agent session so it
loads the new skills, then `/quest-plan` (`$quest-plan` in Codex) to plan
work or `/quest-import` to bring in open GitHub issues.

## Remove

1. Run `quest skill export` and follow it, so active quests become GitHub
   issues. Skip this only if the user says so.
2. Run `quest uninstall`. It removes only unmodified stubs and the `Quests: `
   line, and never deletes the quest tree.
3. Remove the pin added above: the mise entry, or the flake input and dev
   shell package. For an unpinned install, delete the `quest` binary the
   installer placed (`~/.local/bin/quest` by default).
4. Ask the user whether to delete `quest/`. Git history keeps the plans either
   way.
