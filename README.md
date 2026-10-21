<p align="center"><img src="design/theme/logo.svg" alt="" width="96" height="96"></p>

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

## Required

- [CSV endpoint](/quest/m0/export.md) - the button needs something to call
```

That file sits in your quest log, a tree under `quest/`:

```text
quest/
  README.md           # The roadmap
  m0/
    README.md         # First milestone, in priority order
    export.md         # Ready
    download.md       # Required: export.md
```

Folders are **epics**. A README's `Required` lists its children in
priority order, beside any other dependencies. The README is the epic's
own quest, and it becomes ready once its children have merged. The top folders
(`m0`, `m1`, ...) are **milestones** that give the work a delivery horizon.

When a quest is complete, its PR removes the plan and the links that depended
on it, so the quests that required it can become ready. Milestones are never
deleted, so a PR that finishes one (its README has no `Required` left) removes
the links to that milestone too; `quest check` flags any it misses. The
finished plan stays in Git history, beside the code that completed it.

Work is taken through a live runner lock or an open change on the forge.
kix.quest records each active job in its database and reassigns a job whose
runner goes offline. On GitHub, a draft PR
opened from the quest's branch, including from a fork, claims the work. These
states stay out of the plan file.

## Try it

Build from source with [Bun](https://bun.sh) (or enter the pinned shell with
`nix develop`), then link the `quest` command:

```sh
git clone https://github.com/kixelated/quest.git
cd quest
bun install --frozen-lockfile
bun run build
bun link
```

With Nix, `nix run github:kixelated/quest -- --help` builds and runs it instead.
Native Windows needs no WSL for Quest: see [installation and removal](docs/windows.md).
Windows ZIP artifacts are added by the next release containing this change;
older releases remain macOS/Linux-only.

The [CSV export example](examples/export/quest/README.md) is a small, working
quest tree. From this checkout:

```console
$ quest --root examples/export check
The quest log is in order: 4 documents checked.

$ quest --root examples/export ready
1 quest ready
! [S] Add a CSV export endpoint  quest/m0/export.md

$ quest --root examples/export ready quest/m0/download.md
! [S] Add a download button        quest/m0/download.md
  Required:
    [S] Add a CSV export endpoint  quest/m0/export.md
```

With no path, `ready` lists every ready quest. Given a path, it shows what
blocks that quest. On a terminal, a yellow `!` marks a ready quest and a grey
`!` a blocked one, and each size label takes its colour, like loot rarity: XS
grey, S green, M blue, L purple, and XL orange (your terminal's yellow). Set
`NO_COLOR` to keep the layout without colours.

Scripts and agents read the piped form, which is plain text:

```console
$ quest --root examples/export ready | cat
quest/m0/export.md

$ quest --root examples/export ready quest/m0/download.md | cat
quest/m0/export.md
```

Piped, `ready` prints one path per line. Given a path, it prints that quest's
blockers, with an explanation on stderr; no blockers means no stdout.
It exits zero for both ready and blocked quests; a nonzero exit means the
command failed. Run `check` first to catch malformed plans. `ready` reads
dependencies in the quest tree; it does not inspect live runner locks, open changes, or GitHub branch
claims. Check those before you start work someone else may already be on.

## Prioritize ready work

`quest unblocked` ranks ready quests by milestone priority, descending number
of distinct transitive dependents, then existing tree order. Counts include
later milestones without moving their candidates ahead of earlier milestones.
Structural root, milestone, and epic membership does not add to the count;
real dependencies on an epic still reach its remaining work. Other prerequisites
may remain for a dependent after the selected quest finishes.

```console
$ quest --root examples/export unblocked
1	quest/m0/export.md

$ quest --root examples/export unblocked --json --limit 1
[{"path":"quest/m0/export.md","dependents":1}]
```

Each plain output line contains the count, a tab, and the path. On a terminal,
a heading explains the count. `--json` prints an ordered array, including `[]`
when no quests are ready; `--limit <count>` requires a positive integer.
Invalid trees fail with diagnostics and no ranking. This command uses the same
local readiness as `ready`; verify claims and outside conditions before starting.
`quest-spawn` uses the ranking unless you explicitly select work in another order.

## Wait for pull request activity

`quest wait` blocks until a GitHub PR has a review, comment, review-thread
reply, reaction to the PR or one of its reviews, push, merge, close, removal
from the merge queue, or disabled auto-merge:

```sh
quest wait 101
quest wait https://github.com/kixelated/quest/pull/101 --since 2026-10-07T12:00:00Z --timeout 1800
quest wait 101 --since abcdef0123456789abcdef0123456789abcdef01
```

A number uses the repository's `origin`; a URL works from any directory.
Authentication comes from `GH_TOKEN`, then `GITHUB_TOKEN`, then `gh auth token`.
Without `--since`, the point is the current head's push time, so an existing
review on that head is included. A SHA must have been a pushed tip; if its push
time cannot be found, pass an ISO timestamp instead. Forks use the head
repository's activity. Deleted head repositories require a timestamp.
The initial PR commit listing must match the resolved head; a racing push or
GitHub's 250-commit listing limit fails clearly instead of guessing membership.

Output is plain, one line per event: timestamp (or SHA for a newly observed
commit), type, actor, and URL. The last line adds a resume cursor. Pass its
**last field** as `--since` on the next call. Cursors preserve commit membership
and events sharing a timestamp; treat them as opaque, and use them only for the
same PR. Explicit timestamps include events at that instant. Historical plain
pushes come from repository activity; pushes observed while waiting come from new
commit SHAs, regardless of git author dates. Force pushes come from the PR
timeline, excluding the one that created the starting head. A merge through
the queue prints `removed_from_merge_queue` about a second before `merged`, so a
poll can catch the removal alone; check the PR's state before treating it as a
failed merge. Actors are printed without deciding
whose review counts. Check runs and edits to existing comments or reviews are
outside this command's scope.

Review-thread replies and reactions never reach the PR timeline, so they are
read separately. A reply prints as `replied`; a thread's first comment is part
of a review and prints as `reviewed`. Reactions on the PR body or a review
print as `reacted:<content>`, so a clean review that only leaves a 👍 prints
`reacted:thumbs_up`. Each poll reads the newest 100 reactions on each, so a
burst of more than that still wakes the waiter but prints only the newest;
reactions on other comments are not read. Replies and
reactions by the authenticated account are ignored, so an agent's own replies
do not wake it; activity from a person sharing that account is ignored too.
The cursor keeps a separate position for each source, so a reply that becomes
visible after a newer reaction is still reported.

Each poll makes one conditional timeline request and one conditional
review-comment request every five minutes once it has read the existing pages,
following a new page when the current one fills, plus one GraphQL query for
reactions. It honors GitHub's rate-limit headers and fails loudly on invalid responses.
There is no deadline unless `--timeout <seconds>` is supplied. Activity exits 0,
timeout exits 3, invalid arguments exit 2, and other failures exit 1; interrupt
with Ctrl-C to stop waiting. A timeout prints a resume point as its only line:
a cursor, or the given `--since` (else the head SHA) if setup had not finished.
Retry with it, not the original command, so activity that landed during the
first wait is still reported.

## Work with your agents

Open this repository in Claude Code or Codex. The binary carries the skills;
a repository installs only a stub per skill that runs `quest skill <name>`, so
the version you pin decides what your agents follow:

| Skill | What it does |
| --- | --- |
| `quest-plan` | Ask the questions that turn an idea into scoped quests. |
| `quest-recurring` | Plan a quest whose finishing PR creates its next occurrence, and what gates it. |
| `quest-import` | Bring open GitHub issues into the planning conversation. |
| `quest-export` | Turn active quests into GitHub issues before leaving Quest. |
| `quest-audit` | Find conflicting, stale, or misprioritized quests, then resolve them. |
| `quest-start` | Claim a ready quest, complete it, and open a PR. |
| `quest-spawn` | Triage ready quests and send several agents out in parallel. |
| `quest-iterate` | Iterate on an open PR to settle its open decisions, fix CI and review findings, and push. |
| `quest-ready` | Mark a draft PR ready for review, wait for an automated review, then decide whether to merge. |
| `quest-merge` | Merge a quest's PR once CI and reviews pass, completing the quest. |
| `quest-complete` | Decide which open PRs to merge, then merge them in parallel. |
| `quest-delete` | Abandon a quest, deleting it in its own PR. |

Use `/quest-plan` in Claude Code or `$quest-plan` in Codex. Skills coordinate
within your agent session. A started quest stops at a pull request; merging is
a separate invocation, so you review every change.

Before stepping away, add `afk` to `/quest-spawn` or `/quest-complete`: the
agent acts on its own recommendations and asks only before merging or deleting.

To bill spawned agents to API keys instead of your agent's account, export
`QUEST_API_KEYS` with one or more whitespace-separated keys and run
`/quest-spawn api`. Entries may be secret references such as 1Password `op://`
URIs, resolved in one `op inject` when the spawn starts; a 1Password service
account token (`OP_SERVICE_ACCOUNT_TOKEN`) avoids even that prompt. Each quest
runs as a headless `claude -p` or `codex exec` process on one key; a key whose
credit runs out is dropped, and spawning stops once every key is exhausted.
Disable auto-reload or set a spend limit in each provider console so draining a
key cannot charge a card. Agents run as your user, so they are not isolated from
the other keys.

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
pins its version, and your repository's instructions stay yours. Quest supports
macOS, Linux, and [native Windows](docs/windows.md).

The hosted service is moving to [kix.quest](https://kix.quest): maintainers
plan issues, start ready quests, and act on GitHub PRs through a decision UI.
Hosted work will use explicitly selected maintainer or donor API funding.
[The first milestone](quest/m0/README.md) lists the quests that remain.

## Contributing

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
