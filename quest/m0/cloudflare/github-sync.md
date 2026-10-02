# [M] Sync with GitHub

## Goal

A project can be paired with a GitHub repository. `main`, quest branches, and
`refs/notes/quest` mirror both ways, fast-forward only. When the two sides
have diverged, the UI flags it instead of either side overwriting the other.
Claims, issues, quests, and reviews sync because they are files and notes.

## Plan

- Triggers: Artifacts push events, and a GitHub webhook from a GitHub App.
  The GitHub App is shared with [onboarding](/quest/m0/cloudflare/onboard.md).
- Sync runs real git in a Sandbox, or uses isomorphic-git if that proves
  enough. Push to Artifacts uses receive-pack v1.

## Required

- [Worker scaffold](/quest/m0/cloudflare/scaffold.md) - the app and its repositories
