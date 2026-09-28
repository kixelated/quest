# Use Quest in your repository

Setup is manual for now; `quest init` will automate it. The binary carries the
skills and the quest guide, so your repository only pins a version and installs
small stubs that call it.

## Install and pin the binary

There are no release binaries yet, so build from source. Pin it with the tool
manager your repository already uses:

- mise: `mise use 'cargo:https://github.com/kixelated/quest@rev:<sha>'`
- nix: add `github:kixelated/quest/<sha>` as a flake input and put its
  `packages.default` in your dev shell.
- Otherwise: `cargo install --locked --git https://github.com/kixelated/quest`,
  which is unpinned.

The package requires Rust 1.91 or newer.

## Add the stubs and the reference line

From your repository root:

```sh
for skill in $(quest skill | cut -d' ' -f1); do
  mkdir -p .claude/skills/quest-$skill
  quest skill --stub $skill > .claude/skills/quest-$skill/SKILL.md
done
echo /.scratch/ >> .gitignore
```

Check for existing skills with the same names first. Codex reads skills from
`.agents/skills/`; a directory symlink to `.claude/skills` shares one copy.

Add one line to your root `AGENTS.md` or `CLAUDE.md`: when work mentions a quest,
run `quest guide` and follow it. Keep repository-specific rules there too; the
stubs never change between versions, so upgrading is only a new pin.

Claude Code's direct `AGENTS.md` support starts at v2.1.277 and depends on the
session configuration. An existing project or ancestor `CLAUDE.md` can take
precedence. See [Claude's instruction-loading rules](https://code.claude.com/docs/en/memory#agentsmd)
if the shared instructions do not load.

## Start a roadmap

Create `quest/README.md`:

```markdown
# Quests

## Goal

What this project is working toward.

## Quests
```

An empty root is valid. Invoke `/quest-plan` in Claude Code or `$quest-plan` in
Codex with an outcome you want to work toward. The skill helps settle the scope,
then creates milestones, quests, and dependencies. See the
[CSV export example](../examples/export/quest/README.md) for a populated tree.

From your repository root, validate the result and look for ready work:

```sh
quest check
quest ready
quest branch quest/m0/some-quest.md
```

`branch` prints that quest's branch and each branch it merges through, ending
at `main`. Milestones themselves have no branch. Children merge into their
line's branch first, so after a `git fetch`, `quest ready --remote origin`
reads each line from its branch instead of the working tree.

Review the plan before starting it. `/quest-start` works on one quest;
`/quest-spawn` coordinates multiple agents when your session supports them.
Use `$quest-start` and `$quest-spawn` in Codex. Existing branch claims and PRs
still need checking; the local readiness command cannot see them.

## Update or remove it

Upgrade by changing the pin; the stubs stay as they are. Issue export and
`quest uninstall` are not implemented yet. If you stop using Quest, preserve any
unfinished plans before removing the stubs, the pin, and the reference line.
Completed plans remain in Git history.
