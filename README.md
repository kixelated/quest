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
on it, so the quests that required it can become ready. A PR that leaves work
rewrites the plan to what remains. Milestones are never
deleted, so a PR that finishes one (its README has no `Required` left) removes
the links to that milestone too; `quest check` flags any it misses. The
finished plan stays in Git history, beside the code that completed it.

Work is taken through a live runner lock or an open change on the forge.
kix.quest records each active job in its database and reassigns a job whose
runner goes offline. On GitHub, a draft PR
opened from the quest's branch, including from a fork, claims the work;
`quest start` opens one. These states stay out of the plan file.

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

$ quest --root examples/export unblocked
1	quest/m0/export.md

$ quest --root examples/export unblocked quest/m0/download.md
! [S] Add a download button        quest/m0/download.md
  Required:
    [S] Add a CSV export endpoint  quest/m0/export.md
```

With no path, `unblocked` ranks every ready quest. Given a path, it shows what
blocks that quest. On a terminal, a yellow `!` marks a ready quest and a grey
`!` a blocked one, and each size label takes its colour, like loot rarity: XS
grey, S green, M blue, L purple, and XL orange (your terminal's yellow). Set
`NO_COLOR` to keep the layout without colours.

Scripts and agents read the piped form, which is plain text:

```console
$ quest --root examples/export unblocked quest/m0/download.md | cat
quest/m0/export.md
```

Piped, a path prints that quest's blockers, with an explanation on stderr; no
blockers means no stdout. It exits zero for both ready and blocked quests; a
nonzero exit means the command failed.

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
Invalid trees fail with diagnostics and no ranking.
`quest-spawn` uses the ranking unless you explicitly select work in another order.

`--unclaimed` drops quests someone already holds: the quest's branch on the
upstream repository, or an open PR from that branch in any repository, forks
included. It lists each one it skips on stderr with its PR and how long ago
that PR was last active, so you can decide whether a stale claim should be
taken over. In a fork's clone, the upstream is the fork's parent, and the
fork's own branches and PRs count too; `--remote` picks a remote other than
`origin`. Off GitHub, only branches are checked.
Neither form inspects kix.quest runner locks or outside conditions.

## Claim a quest

`quest start` claims a ready quest so every claim is visible on GitHub:

```sh
quest start quest/m0/export.md
quest start --release quest/m0/export.md
```

It pushes an empty claim commit, built on the upstream default branch, to the
quest's branch (its path without `.md`) without forcing, then opens a draft PR
from it right away and prints the PR's URL. It switches your checkout to the
claim on a new local branch, or fast-forwards that branch if it is already
checked out. A fork pushes to itself and opens the PR on its parent. It fails
on a tree `quest check` rejects, which can hide a blocker, and refuses a
blocked quest and one someone else holds; a rejected push means
another claimer got there first, and when two PRs race, the earliest open one
keeps the claim and the later one is closed. Off GitHub, it pushes the branch
without a PR.

`--release` deletes the branch, with a lease on its tip, and closes its PR, but
only while the tip is still an empty commit. Once work is on the branch, hand
the draft back instead: a `## Decisions needed` section in its body marks it as
waiting on the maintainer.

`quest start` exits 0 when done, 3 when it refuses (blocked, held, or work on
the branch), 2 for invalid arguments, and 1 for other failures. On GitHub it
uses `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token`.

Draft claims are placeholders, so CI can skip them. This repository runs its
checks only on PRs ready for review: the `pull_request` trigger lists
`ready_for_review`, and each job has the condition
`github.event_name != 'pull_request' || github.event.pull_request.draft == false`.

## Check a quest's PR

A PR from a quest's branch must leave that quest accurate. `quest check --base
<ref>` runs the usual check, then compares the working tree with its merge base
with `<ref>`. When the branch is a quest's path without `.md` (an epic's is
`quest/<path>/README`) and that quest exists at the merge base, the diff must
delete or edit it. Any other branch passes. The branch defaults to the current one;
`--branch <name>` names the PR's head branch instead:

```sh
git fetch origin main
quest check --base origin/main --branch quest/m0/export
```

Fetch the base first, since a stale one can predate the quest. The
`quest-merge` skill runs this before enabling auto-merge. A repository with
`quest` installed in CI can also run it on pull requests, where the checkout is
detached, so pass the head branch:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- run: quest check --base "origin/$GITHUB_BASE_REF" --branch "$GITHUB_HEAD_REF"
```

The check is a floor, not a review: any edit to the quest passes, so reviewers
still judge whether a rewrite matches what remains.

## Move and delete quests

`quest mv` and `quest rm` move or delete a quest or an epic with `git mv` and
`git rm`, then fix the links so the tree still passes `quest check`:

```sh
quest mv quest/m0/export.md quest/m1/export.md
quest mv quest/m0/drain quest/m1/drain
quest rm quest/m0/download.md
quest rm -r quest/m1/drain
```

`mv` rewrites every root-absolute link to the moved path, and to everything
under a moved epic. `rm` drops each `Required`, `Related`, or `Closes` entry
that links to what it deleted, and the heading if that was the last entry.
It also drops every `Required` link to a finished milestone, including one it
just finished, but keeps the root's listing of the milestone.
Both stage the change, print one line per file (`R from -> to`, `D path`, or
`M path`), and report on stderr any other mention of the path, such as prose
or files outside `quest/`, without editing it. They run `quest check` on the
result and exit 1 if it fails, for example when a quest moved out of its epic.

An epic is its directory or README; removing one that holds other quests needs
`-r`. The root and milestones are never moved or removed. `mv` refuses a
destination that exists, and refuses to move a quest while it has a claim
branch or open PR on `origin`, or on the repository a GitHub fork came from,
since the branch would no longer name it.
Neither command touches branches or PRs.

## Wait for pull request activity

`quest wait` blocks until a GitHub PR has a review, comment, review-thread
reply, reaction to the PR or one of its reviews, push, merge, close, removal
from the merge queue, disabled auto-merge, or required CI result:

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
poll can catch the removal alone; check `quest status` before treating it as a
failed merge. Actors are printed without deciding
whose review counts. Edits to existing comments or reviews are outside this
command's scope.

CI results are read for the current head. The first required check to fail
prints `checks:failed` right away. `checks:passed` prints once nothing on the
head is still going (no pending check and no unfinished GitHub Actions run, which
may still create jobs), every check and workflow the base branch names is
present, and every required check passed; it names the last check to finish,
when the head went idle. Each prints once per head, with the check's name
(spaces as `_`) in the actor field and its details URL. Results count as
`quest status` counts them, so neutral and skipped results pass. Each job of a
workflow a ruleset requires is required.
Requiredness comes from the base branch's protection and rulesets, readable
with read access; optional checks never wake the wait, unless the base branch
requires none, in which case every check is required. A result counts when it
was reached at or after the starting point, so a wait started after CI finished
still reports it; a push starts over for the new head, and the cursor records
what was reported, so resuming never replays it.

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
following a new page when the current one fills, plus one GraphQL query each
for reactions and checks. It reads the base branch's required checks once per
call. It honors GitHub's rate-limit headers and fails loudly on invalid responses.
There is no deadline unless `--timeout <seconds>` is supplied. Activity exits 0,
timeout exits 3, invalid arguments exit 2, and other failures exit 1; interrupt
with Ctrl-C to stop waiting. A timeout prints a resume point as its only line:
a cursor, or the given `--since` (else the head SHA) if setup had not finished.
Retry with it, not the original command, so activity that landed during the
first wait is still reported.

## Read a pull request's state

`quest status` prints a GitHub PR's current state in one call, such as after
`quest wait` wakes. It accepts the same PR argument and authentication as
`quest wait`, and reports facts without deciding whether the PR is ready or
whose review counts:

```console
$ quest status 128
url https://github.com/kixelated/quest/pull/128
state open
draft false
head 0ade9d977d54c6f48152410532c58e9ea78db3d0
mergeable conflicting
merge-state dirty
review-decision -
auto-merge -
merge-queue -
checks success passed=14 failing=0 pending=0
review stale commented kixelated 2026-10-16T06:14:04Z https://github.com/kixelated/quest/pull/128#pullrequestreview-5543745302
review current commented chatgpt-codex-connector 2026-10-16T17:57:16Z https://github.com/kixelated/quest/pull/128#pullrequestreview-5551703054
thread PRRT_kwDOUhuoys6tUUV2 current chatgpt-codex-connector https://github.com/kixelated/quest/pull/128#discussion_r4297708263 src/cli/gate.ts:115
```

Each line starts with its record type; any free text, a check name or a path,
comes last, and a missing value prints as `-`:

| Line | Fields |
| --- | --- |
| `url`, `state`, `draft`, `head` | The PR URL; `open`, `closed`, or `merged`; `true` or `false`; the head SHA. |
| `mergeable`, `merge-state`, `review-decision` | GitHub's values, lowercased. |
| `auto-merge` | Method, who enabled it, and when. |
| `merge-queue` | Queue state, position, and when it was enqueued. |
| `checks` | The head's rollup state and `passed=`, `failing=`, `pending=` counts. |
| `check` | `failing` or `pending`, `required` or `optional`, the result, details URL, and name. |
| `review` | `current` or `stale` against the head, state, reviewer, time, and URL of each reviewer's latest review. |
| `reacted:<content>` | Actor, time, and the PR or review reacted to, as `quest wait` names reactions. |
| `thread` | Node ID, `current` or `outdated`, last commenter, latest comment URL, and `path:line` of each unresolved thread. |

The node ID is what GraphQL's `addPullRequestReviewThreadReply` and
`resolveReviewThread` take. Neutral and skipped checks pass. A required check
is one branch protection or a ruleset requires for this PR. `--json` prints the
same facts as one object with the fields `url`, `state`, `draft`, `head`,
`mergeable`, `mergeState`, `reviewDecision`, `autoMerge`, `mergeQueue`,
`checks` (`state`, `passed`, `failing`, `pending`), `reviews`, `reactions`, and
`threads`. Long lists are paged; reactions are the newest 100 per PR or review,
as in `quest wait`. Any PR state exits 0, invalid arguments exit 2, and other
failures exit 1.

## Gate expensive commands

`quest gate <command> [args...]` holds an expensive command until the host has
room for it, across all of a user's repositories and worktrees:

```sh
quest gate bun run test
quest gate cargo build --release
```

Admission is sized from the host, with no configuration. Every platform waits
while the host-wide 1-minute load average exceeds the host's CPU count, or while
available memory is below one command's budget: 4 GiB, or a quarter of RAM on
smaller hosts, where RAM is capped by any container memory limit. On Linux,
available memory includes reclaimable host and cgroup file cache and is bounded
by the remaining budget of each enclosing memory cgroup. Load and memory count
work from every session and user. The load average lags new work, so the gate
admits at most one waiting command per 5-second window per host, never in
consecutive windows, rather than releasing every waiter at once: a burst of
waiters starts about 10 seconds apart. Windows reports no load
average and macOS counts reclaimable cache as used memory, so those signals are
skipped there.

Admission is the gate's only job: it holds no slot or lock while the command
runs and does not track the command's descendants. A nested invocation runs
immediately inside the admitted command. Internal compiler or test worker
parallelism remains the command's responsibility.

This repository's `just check`, `just test`, `just worker-check`, and
`just worker-test` run through the gate.

Arguments, working directory, environment and terminal streams pass through to
the executable, and waiting happens before it starts. There is no fairness
guarantee or timeout: a command waits as long as the host stays busy.

## Prunable local checkouts

The experimental `quest worktree` commands share one disk budget across this
user's repositories and release a checkout's disk by deleting its declared
scratch in place. They only operate on Git worktrees they create; use the
owning application for Codex, Claude, or other managed checkouts. Process
supervision remains unfinished: stop agents and commands in a checkout before
releasing it.

Set a shared capacity and an explicit reservation in bytes, covering the
checkout and its expected build output. Measure representative jobs before
choosing the budget. Reservations serialize creators and account for concurrent
expected growth. They do not enforce filesystem quotas against arbitrary
writers, and Git objects stored in the shared repository are not charged.

```sh
quest worktree capacity 20000000000
quest worktree create example --reserve 3000000000 --ref HEAD
quest worktree status
quest worktree release example --scratch node_modules dist
quest worktree restore example
```

Creation prints JSON with the ID and the detached, locked checkout path under
`.worktrees/`. Release deletes only its `--scratch` paths, and refuses one that
Git does not ignore, that holds tracked files or another Git worktree, or that
is reached through a symbolic link; links inside scratch are removed, never
followed. Missing paths
are skipped, so release can be rerun. The checkout, its Git state, and
untracked files stay in place, and `status` charges what remains. Restore
reserves the checkout's disk again; then reinstall or rebuild its scratch, for
example with `just install`.

Quest never removes a checkout. Once one is finished, remove it with
`git worktree unlock` and `git worktree remove`, which refuses modified or
untracked files but deletes ignored ones; `release` then drops its record. A
failed creation stays charged until `release` drops it. Records live in
`$QUEST_WORKTREE_HOME`, or `$XDG_STATE_HOME/quest/worktrees` (default
`~/.local/state/quest/worktrees`). No live lock is stolen: after a crash,
confirm the registry lock's owner has exited before removing it. This initial
interface refuses unknown or changed checkout ownership.

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
