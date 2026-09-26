# Public release planning

These are inputs to the active `/plan-quests` interview, not a fully scoped roadmap.
Split independently deliverable outcomes into sized quests with dependencies once
their material decisions are settled.

## Agreed release goal

The first public release includes the complete adoption loop: installation,
initialization, GitHub issue import, managed updates, and export/removal. It also
includes agent orchestration to spawn agents, start quests, and merge completed
work. Orchestration is part of the first release, not a later enhancement.

The primary audience is individual developers and small teams using Claude Code
or Codex with GitHub. Broader agent and issue-tracker support is not a launch
requirement.

Skills coordinate agents within the user's existing Claude Code or Codex
session. The CLI supplies deterministic operations; launching and supervising
agent processes is not a first-release requirement.

Execution prepares PRs and stops. Merging requires a separate invocation; starting
or spawning quests does not implicitly authorize merging them.

After import, quests own the plan. GitHub issues remain open and linked until
completion. Continuous synchronization between issues and quests is outside the
first-release scope.

Reversal exports active quests and reuses their original GitHub issues where
possible. Uninstall removes only unchanged Quest-managed files, preserving local
edits and Git history. Reconstructing completed quests as closed issues and
restoring the exact pre-install repository state are not launch requirements.

Each binary release bundles a matching set of skills and instruction templates.
Repositories pin their installed version. Upgrades are explicit and provide a
diff while preserving local edits; templates do not automatically track the
latest release or use an independent release stream.

Launch provides prebuilt binaries for macOS and Linux. Windows users use WSL
initially; native Windows binaries are not a launch requirement.

Launch marketing includes the README, quickstart, a real demo, examples beyond
MoQ, a comparison with alternatives, and launch-post drafts. A dedicated public
website and publishing the launch posts are not part of this scope.

The roadmap includes future work as well as launch requirements. Native Windows
support is tracked in the later milestone under `quest/m1/`.
Milestones are explicit: `m0` is the first public release, `m1` is subsequent
work, and `m2` and beyond are added as later outcomes are scoped. Numbers remain
stable; ordering expresses priority and `Required` expresses dependencies.

Installation and removal have skill entrypoints. Skills guide binary installation
and repository setup/removal; deterministic CLI commands track owned files and
apply repeatable changes.

Upgrades never automatically merge installed instructions or skills. Replace only
unchanged Quest-owned files; preserve modified files and show upstream changes
for manual or agent-assisted reconciliation. Keep the repository's existing root
`CLAUDE.md` and `AGENTS.md` user-owned. Setup adds a small reference to separately
managed Quest instructions rather than taking ownership of the root files.

`AGENTS.md` is the canonical instruction filename, including `quest/AGENTS.md`.
Skills and CLI diagnostics refer to that contract. Existing `CLAUDE.md` files in
adopting repositories remain user-owned and are not treated as quests.

## Requested outcomes

- Install a standalone `quest` binary without a MoQ checkout.
- Initialize new or existing repositories without overwriting their instructions.
- Import existing GitHub issues with traceable source links.
- Convert quests back into issues and remove the integration safely.
- Version the binary, quest format, skills, and instruction templates coherently.
- Update installed skills and instructions while preserving repository edits.
- Coordinate agents through spawning, quest execution, review, and merge.
- Publish clear onboarding, examples, positioning, and launch material.

## Existing foundation

The Rust CLI provides `check`, `ready`, `branch`, and an explicit `--root`. It
parses Markdown, validates the tree and dependency graph, orders ready work by
the questline indexes, and names the branch chain a quest merges through. A
README that no longer lists children is itself ready work. Four skills cover
planning, issue triage, execution, and parallel coordination. No installation
manifest, issue migration engine, update command, or binary release pipeline
exists yet.

The extraction removes Cargo workspace dependencies, retains licenses and tests,
and adapts instructions to a standalone contribution workflow. Empty permanent
roots and CRLF documents are supported, with regression coverage.

## Design frontier after the release goal

- Distribution: supported operating systems, source versus prebuilt installation,
  package name availability, release verification, and update policy.
- Initialization: agent targets, ownership of installed files, coexistence with
  existing instructions, dry-run output, and partially initialized repositories.
- Format: stable identity across moves, compatibility versions, metadata needed
  for migration, completion history, and readiness on invalid trees.
- Issues: import selection, issue/comment/label preservation, repeatable retries,
  source identity, and explicit handling of remote edits or duplicates.
- Reversal: export versus full restoration, mapping completed quests to closed
  issues, modified files, interrupted operations, and removal of owned content.
- Updates: coupled versus independent asset versions, local modifications,
  compatibility gates, upgrade previews, rollback, and offline operation.
- Workflow: branch claims, contribution-policy discovery, local-only use, and
  agent concurrency limits. Avoid importing MoQ's automatic merge assumptions.
- Release proof: a fresh repository completing install, init, import, work,
  upgrade, export, and removal without losing user-owned content.
- Marketing: first audience, concrete demo, examples beyond MoQ, positioning,
  launch channels, and feedback from early adopters.

## Research references

Checked 2026-09-19. These are comparison inputs, not endorsed architectural choices.

- [Beads](https://github.com/gastownhall/beads) presents persistent work tracking
  for coding agents. Compare its onboarding and coordination experience.
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) presents spec-driven work for
  coding assistants. Compare how proposals become implementation and history.
- [Claude Code skills](https://code.claude.com/docs/en/skills) documents repository
  skills and reusable distribution.
- [Codex skills](https://developers.openai.com/codex/skills/) documents skill
  discovery and shared skill directories.

A positioning hypothesis to validate: readable plans, explicit dependencies,
and reviewable Git changes, with an adoption path that is easy to reverse.
