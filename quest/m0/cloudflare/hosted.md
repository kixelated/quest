# [L] Run funded quests in hosted Sandboxes

## Goal

A signed-in contributor saves an API key and clicks "fund" on a ready quest.
The app claims the quest for them and runs OpenCode in a Cloudflare Sandbox
on their fork, using their key. The result arrives as a change, and the board
shows the run's status.

## Plan

- OpenCode is provider-agnostic, so one runner image accepts Anthropic,
  OpenAI, OpenRouter, and other keys.
- Keys are stored encrypted per user (with a Worker secret), only decrypted
  into the run's environment, and the user can delete them. Spend caps stay
  with the provider.
- ChatGPT plan funding is out of scope until OpenAI approves hosted use
  ([m1](/quest/m1/chatgpt-hosted.md)).
- Reuse the claim, branch, and change flow from `quest run`, so hosted and
  local runs behave the same.

## Required

- [Changes](/quest/m0/cloudflare/changes.md) - where the result lands
