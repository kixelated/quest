# [S] Wire the home page to the live board

## Goal

On `https://kixel.quest`, every node on the home page's quest map opens that
quest's live board page, and the calls to action ("Accept the quest") lead to
sign-in, onboarding a GitHub repository, and the one-line SETUP paste.

## Plan

- Narrowed on 2026-10-06. The site quest built the design, the shell, and
  the home page (`cloudflare/src/home.tsx`), and its quest map (`cloudflare/src/map.tsx`) draws
  the tree at build time. This quest adds only the live links once the board, sync, and
  onboarding exist. Before then, map nodes link to the quest files on GitHub.
- The board's pages (`/repos/<name>/<quest path>`) landed on 2026-10-07 in
  kixelated/quest#74, reading a build-time snapshot. Decided that day: this
  quest does not wait on [wiring the board to live projects](/quest/a0/cloudflare/board.md).
- Earlier decision kept: Quest's own tree on the board is the most convincing
  demo, so the map's nodes lead into it.
- Quest's own repository reaches Artifacts through GitHub sync.
- Once `https://kixel.quest/setup` is live, the one-line paste in the README
  and `docs/getting-started.md` uses it instead of the GitHub `SETUP.md` URL.

## Required

- [GitHub sync](/quest/a0/cloudflare/github-sync.md) - mirrors Quest's own repository into Artifacts
- [GitHub onboarding](/quest/a0/cloudflare/onboard.md) - the flow the "onboard a repository" call to action leads to
