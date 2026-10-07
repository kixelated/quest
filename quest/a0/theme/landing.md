# [S] Wire the home page's calls to action

## Goal

On `https://kixel.quest`, the home page's calls to action ("Accept the
quest") lead to sign-in, onboarding a GitHub repository, and the one-line SETUP
paste.

## Plan

- Narrowed again on 2026-10-07: the map's quests link to their board pages
  since kixelated/quest#84, which needed neither sync nor onboarding. This
  quest keeps only the calls to action.
- Narrowed on 2026-10-06. The site quest built the design, the shell, and
  the home page (`cloudflare/src/home.tsx`), and its quest map (`cloudflare/src/map.tsx`) draws
  the tree at build time. This quest adds only the calls to action once
  sign-in, sync, and onboarding exist.
- Decided on 2026-10-07: this quest does not wait on
  [wiring the board to live projects](/quest/a0/cloudflare/board.md).
- Once `https://kixel.quest/setup` is live, the one-line paste in the README
  and `docs/getting-started.md` uses it instead of the GitHub `SETUP.md` URL.

## Required

- [GitHub sync](/quest/a0/cloudflare/github-sync.md) - mirrors Quest's own repository into Artifacts
- [GitHub onboarding](/quest/a0/cloudflare/onboard.md) - the flow the "onboard a repository" call to action leads to
