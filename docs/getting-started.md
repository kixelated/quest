# Use Quest in your repository

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
git fetch
git remote set-head origin --auto
quest ready
quest branch quest/m0/some-quest.md
```

`branch` prints that quest's branch and the remote's default branch. Every quest
PR targets that shared trunk. Questlines group related work, with each child
landing independently; the README's remaining work follows in its own PR.
`ready` reads the whole tree from the fetched default branch on `origin`;
`--local` reads only the working tree. Both commands accept `--remote <name>`.

Review the plan before starting it. `/quest-start` works on one quest;
`/quest-spawn` coordinates multiple agents when your session supports them.
Use `$quest-start` and `$quest-spawn` in Codex. Existing branch claims and PRs
still need checking; `quest ready` does not look for them.

## Update or remove it

Upgrade by changing the pin; the stubs stay as they are. To remove Quest, ask
your agent to follow SETUP.md to remove Quest. It exports active quests to
GitHub issues, runs `quest uninstall`, and drops the pin. Uninstall never
deletes your quest tree, and completed plans remain in Git history.
