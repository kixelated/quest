# [XS] Write down whose review counts

## Goal

`CONTRIBUTING.md` states which review satisfies the guide's required review
of a PR head in this repository, so merge agents stop deciding it from
precedent.

## Plan

Decided 2026-10-24 (user) in `/quest-plan`, after a merge wave in which agents
counted Codex reactions and status comments as reviews and landed Dependabot
bumps with none. The user asked for this `CONTRIBUTING.md` edit through this
plan.

- **Posted reviews only (user).** A Codex review counts when Codex posts a
  GitHub review, or a 👍 reaction, on the exact head being landed, with no
  unresolved findings. A status comment that says a review completed does
  not count; with nothing posted, the agent asks the maintainer, as
  [kixelated/quest#209](https://github.com/kixelated/quest/pull/209) did.
  Rejected: counting completed status comments, and requiring the
  maintainer's review after a hand-resolved conflict.
- Dependabot PRs that only bump patch versions or a lockfile need no review.
- The guide's narrower exemptions for changes since the last review (a
  conflict-free base merge, or a reviewer's suggested patch applied
  unchanged) still apply.
