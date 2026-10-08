# [L] Review and merge changes

## Goal

A branch on a contributor's fork that is named for a quest shows up as a
change against upstream main. Maintainers see its diff and `quest check`
result, comment, approve, and merge it in the web UI. A conflict is shown on the change for the contributor's
agent to resolve.

## Plan

- One change model: a quest proposal is just a change that only touches
  `quest/`.
- Comments and approvals are git notes (`refs/notes/quest`) on the change's
  commits, so they sync and agents can read them. The app only caches them.
- Diff, merge, and notes run real git in a Sandbox, because Artifacts has no
  merge or diff API. Checks run from a push-triggered Workflow.
- Only the Worker writes to upstream.
- Amended 2026-10-07: [runners](/quest/a0/cloudflare/runners/README.md) later
  move checks, reviews, and merges onto trusted runners, with the Sandbox as
  the fallback. Keep this quest's flow as that fallback.
