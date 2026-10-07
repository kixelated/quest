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
  ([c1](/quest/c1/chatgpt-hosted.md)).
- The interface calls funding "Offer gold" and shows spend as gold coins
  (display only, from `docs/theme.md`); the API and data model keep plain
  terms.
- Reuse the claim, branch, and change flow from `quest run`, so hosted and
  local runs behave the same.

## Required

- [Fork intake](/quest/c0/cloudflare/intake.md) - forks and claims
- [Changes](/quest/c0/cloudflare/changes.md) - where the result lands
