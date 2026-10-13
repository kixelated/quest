# [M] Wire the quest board to live projects

## Goal

The quest board at `/repos/<name>` reads each project's tree from Artifacts
instead of the build-time snapshot of this repository. It shows open changes
and the quarantined `issues/` files, and a maintainer can promote an issue
from it.

## Plan

- The board itself landed on 2026-10-07: milestones with weighted progress, epics,
  quests with their statuses, a status filter, quest pages, and a recently
  completed list (`cloudflare/src/board/`). Its `Project` type
  (`src/board/project.ts`) is the seam: an Artifacts-backed loader fills the
  same shape, with finished quests cached when sync runs
  (`scripts/history.ts` reads them from `git log`).
- Decided 2026-10-07: the board is a list only. The map of the milestones lives on
  the home page (`cloudflare/src/map.tsx`), where each milestone links to
  its board section.
- Decided 2026-10-07: progress shows both "N of M quests" and a bar weighted
  by size. A quest deleted in a commit that changes nothing outside `quest/`
  counts as abandoned, not finished.
- Who may see a project and who counts as its maintainer come from the
  repository registry that intake adds.
- "Offer gold" shows on ready quests; signed-in contributors see it
  disabled until the [Sandbox runner](/quest/m0/cloudflare/runners/sandbox.md) wires it.
- Active work comes later from runner locks
  ([protocol](/quest/m0/cloudflare/runners/protocol.md)), not claims.

## Required

- [GitHub sync](/quest/m0/cloudflare/github-sync.md) - mirrors repositories into Artifacts and caches finished quests
- [Fork intake](/quest/m0/cloudflare/intake.md) - the registry, issues, and maintainer actions
- [Changes](/quest/m0/cloudflare/changes.md) - the open changes shown on the board
