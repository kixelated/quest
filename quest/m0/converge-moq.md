# [L] Converge MoQ onto standalone Quest

## Goal

moq-dev/moq and moq-dev/moq.pro use this repository's `quest` CLI, skills, and
`quest/AGENTS.md` instead of their own copies, so a workflow fix lands once.
Managed `quest init`/`upgrade` is out of scope; a pinned manual copy is fine
until it exists.

## Plan

- Today there are three forks. moq's `rs/quest` is the only one with
  `quest branch` and line branches that merge into their parent's branch. The
  skills and quest instructions differ in all three repositories.
- Upstream moq's line-branch model first, generalizing anything MoQ-specific
  such as its `dev` branch. Readiness should account for work finished on line
  branches, which moq's `spawn-quests` currently works around in prose.
- The consumers pin a version of this repository (flake input or git
  dependency) and delete their `rs/quest`.
- Vendored skills match the pinned version. Repository-specific rules stay in
  each consumer's own instructions. Carry over the skill fixes from
  moq-dev/moq#4227.
- Open: whether moq.pro diverges on purpose anywhere, and which vendored layout
  the future `quest upgrade` will expect, so the manual copy matches it.
