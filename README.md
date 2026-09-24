# Quest

A backlog you can branch, review, and merge.

Quest puts plans in your repository. Each **quest** is a Markdown file scoped to
one pull request: what needs to happen, what has been decided, and what is in the
way. A small Rust CLI checks the links and dependencies. Skills help Claude Code
and Codex plan the work and pick it up.

It grew out of [MoQ](https://github.com/moq-dev/moq). This is the standalone
version, being built for use in other repositories.

**Early days:** validation, readiness, and the four planning/execution skills are
here. Automatic setup, issue migration, managed upgrades, and a dedicated merge
workflow are still being planned.

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

Folders are **questlines**. Their READMEs list the work in order. Milestones
(`m0`, `m1`, ...) give it a delivery horizon and have no branch of their own;
`Required` links express the actual dependencies. A milestone's quests merge
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

Readiness is local: check branches and PRs before claiming a quest someone else
may already be working on.

## Work with an agent

Open this repository in Claude Code or Codex. The skills ship with it:

| Skill | What it does |
| --- | --- |
| `plan-quests` | Ask the questions that turn an idea into scoped quests. |
| `plan-issues` | Bring selected GitHub issues into the planning conversation. |
| `start-quest` | Claim a ready quest, implement it, and prepare a PR. |
| `spawn-quests` | Triage a scope and hand independent quests to parallel agents. |

Use `/plan-quests` in Claude Code or `$plan-quests` in Codex. Skills coordinate
within your agent session. Starting work stops at a PR; merging is a separate
invocation.

To use Quest in your own repository, follow the [manual setup](docs/getting-started.md).
The [format and workflow](quest/AGENTS.md) fit in one file.

## Where this is going

The first release should let you install Quest, bring in existing GitHub issues,
work through quests, and leave again without losing your plans or local edits.
Skills will guide setup and removal; the binary will handle the repeatable parts.

Upgrades will replace unchanged Quest-owned files and show you changes to files
you edited. Your repository's instructions stay yours. macOS and Linux come first;
[native Windows](quest/m1/windows.md) follows later.

The [planning notes](docs/planning.md) track the decisions still being worked out.

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
