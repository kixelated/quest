# [L] Run the Sandbox as a hosted runner

## Goal

The app runs a runner in a Cloudflare Sandbox on the same protocol as
`quest runner`. A signed-in contributor saves an API key and clicks "fund" on a
ready quest, and the Sandbox takes that run job on their fork with their key.
It is also the trusted fallback: it takes check, review, and merge jobs when
no trusted self-hosted runner is online. The board shows its work live, like
any runner's.

## Plan

- Replaces the earlier hosted-runs quest. Decided 2026-10-07: both backends
  ship in a0, and self-hosting is optional.
- OpenCode is provider-agnostic, so one image accepts Anthropic, OpenAI,
  OpenRouter, and other keys. Keys are stored encrypted per user with a Worker
  secret, decrypted only into the job's environment, and deletable. Spend caps
  stay with the provider. Fallback reviews use a key the maintainer stores for
  the project.
- Each job gets a fresh container, so a funded agent run never shares one with
  a check or review. The Sandbox never holds the cache signing key.
- ChatGPT plan funding waits on OpenAI's approval
  ([a1](/quest/a1/chatgpt-hosted.md)).
- The interface calls funding "Offer gold" and shows spend as gold coins
  (display only, from `design/theme.md`). The API and data model keep plain
  terms.

## Required

- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - the job code the Sandbox reuses
- [Changes](/quest/a0/cloudflare/changes.md) - where results land
