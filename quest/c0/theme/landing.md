# [S] Wire the home page to the live board

## Goal

On `https://kixel.quest`, every node on the home page's quest map opens that
quest's live board page, and the calls to action ("Accept the quest") lead to
sign-in, onboarding a GitHub repository, and the one-line SETUP paste.

## Plan

- Narrowed on 2026-10-06. The site quest built the design, the shell, and
  the home page (`cloudflare/src/home.tsx`), and [Quest map](/quest/c0/theme/map.md) draws
  the tree at build time. This quest adds only the live links once the board, sync, and
  onboarding exist. Before then, map nodes link to the quest files on GitHub.
- Earlier decision kept: Quest's own tree on the board is the most convincing
  demo, so the map's nodes lead into it.
- Quest's own repository reaches Artifacts through GitHub sync.
- Once `https://kixel.quest/setup` is live, the one-line paste in the README
  and `docs/getting-started.md` uses it instead of the GitHub `SETUP.md` URL.

## Required

- [Quest map](/quest/c0/theme/map.md) - the map whose nodes this links up
- [Quest board](/quest/c0/cloudflare/board.md) - the live pages map nodes open
- [GitHub sync](/quest/c0/cloudflare/github-sync.md) - mirrors Quest's own repository into Artifacts
- [GitHub onboarding](/quest/c0/cloudflare/onboard.md) - the flow the "onboard a repository" call to action leads to
