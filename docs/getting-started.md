# Use Quest in your repository

Setup is manual for now. You need the `quest` binary and, for the agent
workflow, the skills and instructions from this repository.

## Vendor it as a submodule

A submodule pins the CLI, the skills, and the instructions to one commit, so
they cannot drift apart. From your repository root:

```sh
git submodule add https://github.com/kixelated/quest .claude/quest
ln -s ../.claude/quest/quest/AGENTS.md quest/AGENTS.md
for skill in plan-issues plan-quests spawn-quests start-quest; do
  ln -s ../quest/.claude/skills/$skill .claude/skills/$skill
done
echo /.scratch/ >> .gitignore
```

Run the pinned CLI with
`cargo run --quiet --locked --manifest-path .claude/quest/Cargo.toml -- check`,
or wrap that in your task runner. It needs Rust 1.91 or newer. Codex reads
skills from `.agents/skills/`; a directory symlink to `.claude/skills` shares
one copy. Check for existing skills with the same names first.

Keep repository-specific rules in your root instructions, not in the vendored
files, and add a line there asking agents to read `quest/AGENTS.md` when work
mentions a quest. Upgrade by moving the submodule to a newer commit. Fresh
worktrees need `git submodule update --init .claude/quest` before the
symlinks resolve.

Claude Code's direct `AGENTS.md` support starts at v2.1.277 and depends on the
session configuration. An existing project or ancestor `CLAUDE.md` can take
precedence. See [Claude's instruction-loading rules](https://code.claude.com/docs/en/memory#agentsmd)
if the shared instructions do not load.

To install the binary instead, run `cargo install --locked --path .` from a
clone of this repository. `nix develop` supplies the pinned toolchain and the
other development tools.

## Start a roadmap

Create `quest/README.md`:

```markdown
# Quests

## Goal

What this project is working toward.

## Quests
```

An empty root is valid. Invoke `/plan-quests` in Claude Code or `$plan-quests` in
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
at `main`. Milestones themselves have no branch.

Review the plan before starting it. `/start-quest` works on one quest;
`/spawn-quests` coordinates multiple agents when your session supports them.
Use `$start-quest` and `$spawn-quests` in Codex. Existing branch claims and PRs
still need checking; the local readiness command cannot see them.

## Update or remove it

Automatic upgrades, issue export, and uninstall are not implemented yet.
Upgrade by moving the submodule and reviewing the diff. If you stop using
Quest, preserve any unfinished plans before removing the submodule, the
symlinks, and the instruction reference. Completed plans remain in Git history.
