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
`CLAUDE.md`. Init writes a stub per skill under `.claude/skills/` and one line
starting with `Quests: ` in your root instructions; reword the rest of that
line freely, since init and uninstall recognize it by the prefix.

## Start your quest log

If `quest init` created an empty root, give it a goal in `quest/README.md`:

```markdown
# Quests

## Goal

What this project is working toward.
```

Invoke `/quest-plan` in Claude Code or `$quest-plan` in Codex with an outcome you
want to work toward. The skill helps settle the scope, then writes the quests,
grouped into questlines and milestones, with what each one requires. See the
[CSV export example](../examples/export/quest/README.md) for a populated tree.

From your repository root, validate the result and list the ready quests:

```sh
quest check
quest ready
```

Review the plan before setting out. `/quest-start` claims one quest and opens a
draft pull request; `/quest-spawn` sends several agents out in
parallel when your session supports them. Use `$quest-start` and
`$quest-spawn` in Codex. Check for quests someone has already claimed on a
branch or in an open PR; `quest ready` does not look for them.

You review each change, and `/quest-merge` lands it once checks and reviews
pass. The quest is complete, its plan leaves the tree, and the next quest
becomes ready.

## Update or remove it

Upgrade by changing the pin; the stubs stay as they are. To remove Quest, ask
your agent to follow SETUP.md to remove Quest. It exports active quests to
GitHub issues, runs `quest uninstall`, and drops the pin. Uninstall never
deletes your quest tree, and completed plans remain in Git history.
