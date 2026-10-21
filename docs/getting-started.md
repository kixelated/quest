# Use Quest in your repository

Give your repository a quest log that you and your agents share: plans as
Markdown files, dependencies that `quest check` keeps honest, and work that
arrives as pull requests you review.

The binary carries the skills and the quest guide, so your repository only pins a
version and installs small stubs that call it.

## Set it up

Paste this into Claude Code or Codex from your repository root:

```text
Follow https://github.com/kixelated/quest/blob/main/SETUP.md to set up Quest here.
```

[SETUP.md](../SETUP.md) has the agent install and pin the binary with mise or a
nix flake, run `quest init`, and fit Quest into your root `AGENTS.md` or
`CLAUDE.md`. Init writes a stub per skill under both `.claude/skills/` and
`.agents/skills/` without requiring symbolic links, and one line
starting with `Quests: ` in your root instructions; reword the rest of that
line freely, since init and uninstall recognize it by the prefix.

For native Windows installation and removal, see [the Windows guide](windows.md).

## Start your quest log

If `quest init` created an empty root, give it a goal in `quest/README.md`:

```markdown
# Quests

## Goal

What this project is working toward.
```

Invoke `/quest-plan` in Claude Code or `$quest-plan` in Codex with an outcome you
want to work toward. The skill helps settle the scope, then writes the quests,
grouped into epics and milestones, with what each one requires. See the
[CSV export example](../examples/export/quest/README.md) for a populated tree.

From your repository root, validate the result and list the ready quests:

```sh
quest check
quest ready
```

Review the plan before setting out. `/quest-start` claims one quest and opens a
pull request; `/quest-spawn` sends several agents out in parallel when
your session supports them. Use `$quest-start` and `$quest-spawn` in Codex.
Check the forge for a live runner lock or an open change before starting.
kix.quest records each active job in its database and reassigns a job whose
runner goes offline. On GitHub, check the upstream repository for the quest's
branch and for open PRs from it, including PRs from forks. `quest ready`
reads dependencies in the quest tree; it does not look for these live states.

You review each change: `/quest-ready` takes a draft to review, and
`/quest-merge` (`$quest-merge` in Codex) merges it once checks and reviews pass.
The quest is complete, its plan leaves the tree, and the quests that required it
can become ready.

## Update or remove it

Upgrade by changing the pin, then rerun `quest init` to add stubs for new
skills; existing stubs stay as they are. To remove Quest, ask
your agent to follow SETUP.md to remove Quest. It exports active quests to
GitHub issues, runs `quest uninstall`, and drops the pin. Uninstall never
deletes your quest tree, and completed plans remain in Git history.
