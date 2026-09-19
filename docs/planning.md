# Public release planning

These are inputs to the active `/plan-quests` interview, not an approved roadmap.
The first decisions are the release boundary and primary audience. Once agreed,
split independently deliverable outcomes into sized quests with dependencies.

## Requested outcomes

- Install a standalone `quest` binary without a MoQ checkout.
- Initialize new or existing repositories without overwriting their instructions.
- Import existing GitHub issues with traceable source links.
- Convert quests back into issues and remove the integration safely.
- Version the binary, quest format, skills, and instruction templates coherently.
- Update installed skills and instructions while preserving repository edits.
- Publish clear onboarding, examples, positioning, and launch material.

## Existing foundation

The Rust CLI provides `check`, `ready`, and an explicit `--root`. It parses
Markdown, validates the tree and dependency graph, and orders ready work by the
questline indexes. Four skills cover planning, issue triage, execution, and
parallel coordination. No installation manifest, issue migration engine, update
command, or binary release pipeline exists yet.

The extraction removes Cargo workspace dependencies, retains licenses and tests,
and adapts instructions to a standalone contribution workflow. Empty permanent
roots and CRLF documents need to work for adoption outside MoQ.

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
