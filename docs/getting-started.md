# Use Quest in your repository

The binary carries the skills and the quest guide, so your repository only pins a
version and installs small stubs that call it.

## Install and pin the binary

There are no release binaries yet, so build from source. Pin it with the tool
manager your repository already uses:

- mise: `mise use 'cargo:https://github.com/kixelated/quest@rev:<sha>'`
- nix: add `github:kixelated/quest/<sha>` as a flake input and put its
  `packages.default` in your dev shell.
- Otherwise: `cargo install --locked --git https://github.com/kixelated/quest`,
  which is unpinned.

The package requires Rust 1.91 or newer.

## Initialize Quest

From your repository root:

```sh
quest init
```

This writes a Quest stub for each shipped skill under `.claude/skills/`, links
`.agents/skills/` to the same tree when needed, adds `/.scratch/` to
`.gitignore`, creates `quest/README.md` when missing, and appends one line to
your root `AGENTS.md` or `CLAUDE.md` telling agents to run `quest guide` when
work mentions a quest.

Init refuses to overwrite an existing same-named skill that is not a Quest stub.
Run it again safely: it only prints paths it changed.

Claude Code's direct `AGENTS.md` support starts at v2.1.277 and depends on the
session configuration. An existing project or ancestor `CLAUDE.md` can take
precedence. See [Claude's instruction-loading rules](https://code.claude.com/docs/en/memory#agentsmd)
if the shared instructions do not load.

## Start a roadmap

If `quest init` created an empty root, edit `quest/README.md`:

```markdown
# Quests

## Goal

What this project is working toward.
```

Invoke `/quest-plan` in Claude Code or `$quest-plan` in Codex with an outcome you
want to work toward. The skill helps settle the scope, then creates milestones,
quests, and dependencies. See the
[CSV export example](../examples/export/quest/README.md) for a populated tree.

From your repository root, validate the result and look for ready work:

```sh
quest check
quest ready
quest branch quest/m0/some-quest.md
```

`branch` prints that quest's branch and each branch it merges through, ending
at `main`. Milestones themselves have no branch. Children merge into their
line's branch first, so `quest ready` reads each line from its branch on
`origin` (fetch first); `--local` reads only the working tree.

Review the plan before starting it. `/quest-start` works on one quest;
`/quest-spawn` coordinates multiple agents when your session supports them.
Use `$quest-start` and `$quest-spawn` in Codex. Existing branch claims and PRs
still need checking; `quest ready` does not look for them.

## Update or remove it

Upgrade by changing the pin; the stubs stay as they are. Before leaving Quest,
export unfinished plans with the export skill, then run:

```sh
quest uninstall
```

Uninstall removes only Quest stubs that still match, the reference line, and the
`/.scratch/` ignore entry. It never deletes your quest tree; completed and
unfinished plans remain in Git history.
