# Quest

A backlog you can branch, review, and merge.

Quest puts plans in your repository. Each **quest** is a Markdown file scoped to
one pull request: what needs to happen, what has been decided, and what is in the
way. A small Rust CLI checks the links and dependencies. Skills help Claude Code
and Codex plan the work and pick it up.

It grew out of [MoQ](https://github.com/moq-dev/moq). This is the standalone
version, being built for use in other repositories.

**Early days:** validation, readiness, and the planning, execution, and merge
skills are here. Automatic setup, issue export, and release binaries are still
being built.

## A quest is just a file

```markdown
# [S] Add a download button

## Goal

People can download their data as a CSV from the settings page.

## Plan

Use the export endpoint. Show progress and let the user retry a failed download.

## Required

- [CSV endpoint](/quest/m0/export.md) - the button needs something to call
```

That file sits in a tree:

```text
quest/
  README.md           # The roadmap
  m0/
    README.md         # First milestone, in priority order
    export.md         # Ready to start
    download.md       # Waiting on export.md
```

Folders are **questlines**. A README's `Required` lists its children in
priority order, beside any other dependencies. Milestones (`m0`, `m1`, ...)
give the work a delivery horizon and have no branch of their own. A milestone's quests merge
toward `main`. A nested line merges into its README's branch, and that README
becomes the line's own quest once its children have landed.

When a quest lands, its PR removes the plan and the links that depended on it.
The next task becomes ready. The finished plan stays in Git history, beside the
code that completed it.

## Try it

Install from source with Rust, or enter the pinned shell with `nix develop`:

```sh
git clone https://github.com/kixelated/quest.git
cd quest
cargo install --locked --path .
```

The [CSV export example](examples/export/quest/README.md) is a small, working
quest tree. From this checkout:

```console
$ quest --root examples/export check
quest: 4 documents ok

$ quest --root examples/export ready
quest/m0/export.md

$ quest --root examples/export ready quest/m0/download.md
quest/m0/export.md

$ quest --root examples/export branch quest/m0/download.md
quest/m0/download
main
```

`ready` prints blockers, with an explanation on stderr. No blockers means no
stdout. It exits zero for both ready and blocked quests; a nonzero exit means
the command failed. Run `check` first to catch malformed plans. `branch` prints
the quest's branch, then each branch it merges through, nearest first and
ending at `main`. A milestone has no branch, so its quests merge straight into
`main`.

`ready` reads each questline from its branch on `origin` (fetch first;
`--local` skips this). It does not look for claims or PRs, so check those before
starting a quest someone else may already be working on.

## Work with an agent

Open this repository in Claude Code or Codex. The binary carries the skills;
a repository installs only a stub per skill that runs `quest skill <name>`, so
the version you pin decides what your agents follow:

| Skill | What it does |
| --- | --- |
| `quest-plan` | Ask the questions that turn an idea into scoped quests. |
| `quest-convert` | Bring open GitHub issues into the planning conversation. |
| `quest-audit` | Find conflicting, stale, or misprioritized quests, then resolve them. |
| `quest-start` | Claim a ready quest, implement it, and prepare a PR. |
| `quest-spawn` | Triage ready quests and hand them to parallel agents. |
| `quest-merge` | Land a quest's PR once CI and reviews pass. |
| `quest-finish` | Decide which open PRs to merge, then merge them in parallel. |
| `quest-delete` | Abandon a quest, deleting it in its own PR. |

Use `/quest-plan` in Claude Code or `$quest-plan` in Codex. Skills coordinate
within your agent session. Starting work stops at a PR; merging is a separate
invocation.

To use Quest in your own repository, follow the [manual setup](docs/getting-started.md).
`quest guide` prints the format and workflow.

## Where this is going

The first release should let you paste one line into your agent to set Quest up,
bring in existing GitHub issues, work through quests, and leave again without
losing your plans. The binary carries the skills, your tool manager (mise or nix)
pins its version, and your repository's instructions stay yours. macOS and Linux
come first; [native Windows](quest/m1/windows.md) follows later.

The [first release plan](quest/m0/README.md) lists what is left.

## Hack on it

```sh
nix develop
just check
just test
just build
```

CI runs the same checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

MIT or Apache-2.0, your choice. The CLI, initial skills, and development setup
were extracted from [MoQ at `2bb3e6e`](https://github.com/moq-dev/moq/tree/2bb3e6e3f3f357be7bb5f7a8e7feb4348cfdefe4).
Original notices are preserved in [LICENSE-MIT](LICENSE-MIT) and
[LICENSE-APACHE](LICENSE-APACHE).
