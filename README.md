<p align="center"><img src="docs/theme/logo.svg" alt="" width="96" height="96"></p>

# Quest

**A quest log for your repo and your agents.**

Readable plans, explicit dependencies, and reviewable Git changes. Quest keeps
your plans in your repository, so you and your agents read, claim, and finish
the same work. Each **quest** is a Markdown file scoped to one pull request: its
goal, what has been decided, and what stands in the way. A small TypeScript CLI
checks the links and dependencies. Skills help Claude Code and Codex plan the
work and set out on it.

It grew out of [MoQ](https://github.com/moq-dev/moq). This is the standalone
version, being built for use in other repositories.

**Early days:** validation, readiness, init/uninstall, and the planning,
execution, merge, and export skills are here. Release binaries are still being
built.

## Every plan is a file

```markdown
# [S] Add a download button

## Goal

People can download their data as a CSV from the settings page.

## Plan

Use the export endpoint. Show progress and let the user retry a failed download.

## Claim

- Jane Doe (github:jdoe) on https://example.com/jdoe/repo since 2026-10-02

## Required

- [CSV endpoint](/quest/a0/export.md) - the button needs something to call
```

That file sits in your quest log, a tree under `quest/`:

```text
quest/
  README.md           # The roadmap
  a0/
    README.md         # First act, in priority order
    export.md         # Ready
    download.md       # Required: export.md
```

Folders are **epics**. A README's `Required` lists its children in
priority order, beside any other dependencies. The README is the epic's
own quest, and it becomes ready once its children have merged. The top folders
(`a0`, `a1`, ...) are **acts** that give the work a delivery horizon.

When a quest is complete, its PR removes the plan and the links that depended
on it, so the quests that required it can become ready. The finished plan stays
in Git history, beside the code that completed it.

An optional `Claim` section marks a quest as claimed. Its single bullet names
the claimant, their identity provider, fork or branch, and date; forges may
append fields. Remove the section to release the claim. The CLI leaves expiry
policy to the forge.

## Try it

Build from source with Node 22.12 or newer (or enter the pinned shell with
`nix develop`), then link the `quest` command:

```sh
git clone https://github.com/kixelated/quest.git
cd quest
npm ci
npm run build
npm link
```

With Nix, `nix run github:kixelated/quest -- --help` builds and runs it instead.

The [CSV export example](examples/export/quest/README.md) is a small, working
quest tree. From this checkout:

```console
$ quest --root examples/export check
quest: 4 documents ok

$ quest --root examples/export ready
quest/a0/export.md

$ quest --root examples/export ready quest/a0/download.md
quest/a0/export.md
```

With no path, `ready` lists every ready quest. Given a path, it prints what
blocks that quest, with an explanation on stderr; no blockers means no stdout.
It exits zero for both ready and blocked quests; a nonzero exit means the
command failed. Run `check` first to catch malformed plans. `ready` skips
quests claimed through a `Claim` section and reports the claim as the blocker
for a claimed quest's path. It does not look for branch claims or open PRs, so
check those before you claim a quest someone else may already be on.

## Work with your agents

Open this repository in Claude Code or Codex. The binary carries the skills;
a repository installs only a stub per skill that runs `quest skill <name>`, so
the version you pin decides what your agents follow:

| Skill | What it does |
| --- | --- |
| `quest-plan` | Ask the questions that turn an idea into scoped quests. |
| `quest-import` | Bring open GitHub issues into the planning conversation. |
| `quest-export` | Turn active quests into GitHub issues before leaving Quest. |
| `quest-audit` | Find conflicting, stale, or misprioritized quests, then resolve them. |
| `quest-start` | Claim a ready quest, complete it, and open a draft PR. |
| `quest-spawn` | Triage ready quests and send several agents out in parallel. |
| `quest-iterate` | Iterate on an open PR to settle its open decisions, fix CI and review findings, and push. |
| `quest-merge` | Merge a quest's PR once CI and reviews pass, completing the quest. |
| `quest-complete` | Decide which open PRs to merge, then merge them in parallel. |
| `quest-delete` | Abandon a quest, deleting it in its own PR. |

Use `/quest-plan` in Claude Code or `$quest-plan` in Codex. Skills coordinate
within your agent session. A started quest stops at a pull request; merging is
a separate invocation, so you review every change.

To use Quest in your own repository, paste this into your agent:

```text
Follow https://github.com/kixelated/quest/blob/main/SETUP.md to set up Quest here.
```

The [getting started guide](docs/getting-started.md) covers what happens next.
`quest guide` prints the format and workflow.

## Where this is going

The first release should let you paste one line into your agent to set Quest up,
bring in existing GitHub issues, work through quests, and leave again without
losing your plans. The binary carries the skills, your tool manager (mise or nix)
pins its version, and your repository's instructions stay yours. macOS and Linux
come first; [native Windows](quest/a1/windows.md) follows later.

The release also brings a quest board to [kixel.quest](https://kixel.quest).
Contributors sign in, claim a ready quest, and offer gold, their own agent
tokens, to run it; maintainers review and merge the result there, synced
with GitHub. [The first act](quest/a0/README.md) lists the quests that
remain.

## Join the party

Quest is planned in the open with Quest itself: [its quest log](quest/README.md)
is the backlog, and contributors claim quests from the same log their agents
read. To work on Quest:

```sh
nix develop
just install
just check
just test
just build
```

CI runs the same checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

MIT or Apache-2.0, your choice. The CLI, initial skills, and development setup
were extracted from [MoQ at `2bb3e6e`](https://github.com/moq-dev/moq/tree/2bb3e6e3f3f357be7bb5f7a8e7feb4348cfdefe4).
Original notices are preserved in [LICENSE-MIT](LICENSE-MIT) and
[LICENSE-APACHE](LICENSE-APACHE).
