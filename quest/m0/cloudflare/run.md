# [L] Add a run command for local donated runs

## Goal

`quest run <project url> <quest>` lets a contributor donate their ChatGPT plan
from their own machine. It signs them in with ChatGPT, signs in to the app,
claims the quest from their fork, drives Codex to implement it, and pushes the
result as a change.

## Plan

- This reverses m0's "the CLI stays offline" decision (2026-10-01): `run` lives
  in the main CLI package.
- Sign in with ChatGPT is self-serve for open-source, locally run apps:
  OAuth with PKCE, a loopback `127.0.0.1` callback, and dynamic client
  registration. Drive Codex app-server with the token
  ([docs](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)).
- The app login is a browser device flow that returns the fork's remote and
  token.
- Claiming is git-native: commit the `## Claim` to the fork and push, then let
  [intake](/quest/m0/cloudflare/intake.md) pull it into main. If the claim
  loses a race, stop.
- Give the agent the quest-start workflow and push to the quest's branch on
  the fork. Each push keeps the claim alive.

## Required

- [Fork intake](/quest/m0/cloudflare/intake.md) - forks, tokens, and claims
- [Changes](/quest/m0/cloudflare/changes.md) - where the result lands
