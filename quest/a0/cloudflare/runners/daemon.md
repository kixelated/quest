# [L] Run donated jobs with quest runner

## Goal

`quest runner` runs on a contributor's machine and keeps taking jobs for the
projects it opted into: it locks the top job, does it in a fresh worktree on
the owner's fork, pushes the result as a change, and releases the lock.
`quest run <project url> <quest>` does one quest's run job and exits, so
anyone can implement a specific quest on their own PC. An agent that needs a
decision ends its job with a blocked commit, and a later resume job continues
from the answers.

## Plan

- Replaces the earlier local-runner quest. The CLI is offline except `run` and
  `runner` (amended 2026-10-01 and 2026-10-07).
- Agents come from small adapters that shell out to CLIs the owner already
  installed and logged into (`claude`, `codex`, `opencode`), so Quest never
  stores agent credentials. Sign in with ChatGPT stays as a built-in option for
  owners without Codex: OAuth with PKCE, a loopback callback, and Codex
  app-server
  ([docs](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)).
- Config: projects, agent, max concurrent jobs, and the systems it builds.
  Donor runners only do run and resume jobs; trusted and writer jobs land in
  their own quests.
- Each job gets a fresh worktree, the quest-start workflow, and the agent's
  native sandbox. The runner pushes the quest branch first, so the open change
  appears while the job runs.
- Refuse to start on Nix older than 2.34.5.

## Required

- [Locks and live work](/quest/a0/cloudflare/runners/protocol.md) - jobs, locks, and live status
- [Questions section](/quest/a0/cloudflare/runners/questions.md) - the blocked commit format
- [Changes](/quest/a0/cloudflare/changes.md) - where results land
