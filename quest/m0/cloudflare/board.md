# [M] Wire the quest board to live projects

## Goal

The quest board at `/repos/<name>` reads each project's tree from Artifacts
instead of the build-time snapshot of this repository. It shows open changes
as "Ready to turn in", branch claims as "Accepted by", and the quarantined
`issues/` files, and a maintainer can release a claim and promote an issue
from it.

## Plan

- The board itself landed on 2026-10-07: acts with weighted progress, epics,
  quests with their statuses, a status filter, quest pages, and a recently
  completed list (`cloudflare/src/board/`). Its `Project` type
  (`src/board/project.ts`) is the seam: an Artifacts-backed loader fills the
  same shape, with finished quests cached when sync runs
  (`scripts/history.ts` reads them from `git log`).
- Who may see a project and who counts as its maintainer come from the
  repository registry that intake adds.
- "Offer gold" shows on available quests; signed-in contributors see it
  disabled until [hosted runs](/quest/m0/cloudflare/hosted.md) wire it.
- Open question: whether the board also opens on a map of the acts, like
  the home page's [quest map](/quest/m0/theme/map.md). A mock was shown to
  the user on the board's PR; the list ships alone until they decide.

## Required

- [GitHub sync](/quest/m0/cloudflare/github-sync.md) - mirrors repositories into Artifacts and caches finished quests
- [Fork intake](/quest/m0/cloudflare/intake.md) - the registry, claims, issues, and maintainer actions
- [Changes](/quest/m0/cloudflare/changes.md) - the open changes shown as Ready to turn in
