# Use Quest in your repository

Setup is manual for now. You need the `quest` binary and, if you want the agent
workflow, the skills and instructions from this checkout.

## Install the binary

From a clone of this repository:

```sh
cargo install --locked --path .
```

The package requires Rust 1.91 or newer; `rust-toolchain.toml` pins the development
toolchain. `nix develop` supplies that toolchain and the other development tools.

## Add the instructions and skills

Copy `quest/AGENTS.md` into the same path in your repository. Keep your existing
root instructions and add a brief reference asking agents to read
`quest/AGENTS.md` when working on quests. Adapt its contribution workflow to your
repository's checks and PR conventions.

Copy the four directories under `.claude/skills/` into the project skill location
for the agent you use:

- Claude Code: `.claude/skills/`
- Codex: `.agents/skills/`

If you use both, this repository demonstrates sharing one copy with a directory
symlink. Check for existing skills with the same names before copying anything.

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

Automatic upgrades, issue export, and uninstall are not implemented yet. For
now, review changes to copied files manually and keep your customizations.
If you stop using Quest, preserve any unfinished plans before removing the
skills and instruction references. Completed plans remain in Git history.
