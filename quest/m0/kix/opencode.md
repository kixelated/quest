# [M] Drive opencode from the runner

## Goal

A runner offers opencode accounts alongside Claude Code ones, so a
maintainer can run jobs with an OpenCode Go plan, a ChatGPT plan, or an API
key for any provider opencode supports. Jobs behave the same as Claude Code
jobs in the UI: questions, checkpoint summaries, and results.

## Plan

- Decided 2026-10-15: Claude Code and opencode are the two m0 adapters.
  opencode covers OpenCode Go, ChatGPT/Codex plans, and API-key providers. Add
  a separate Codex adapter only if opencode's ChatGPT support falls short.
- Drive the headless `opencode serve` HTTP/OpenAPI server through its
  TypeScript SDK and Server-Sent Events, bound to localhost with server
  authentication. Pin opencode through the runner's Nix closure.
- Give each account its own isolated opencode config/data home. opencode
  dropped Claude subscription login in March 2026, so Claude subscriptions
  stay on the Claude Code adapter.
- Decided 2026-10-15 for the [job sandbox](/quest/m0/kix/sandbox.md):
  opencode has no native sandbox, so run its commands under Anthropic's
  sandbox-runtime with the runner's `Sandbox` policy (`src/runner/sandbox.ts`).
  Keep the account's login outside what those commands can read: verify how
  much of its home the wrapped process exposes, and deny reads of every other
  account home.
- Verify that structured questions, the checkpoint status tool, resume, and
  cancellation map onto the shared adapter interface without
  provider-specific behavior leaking into the service.
- Sources: [OpenCode Go](https://opencode.ai/docs/go/),
  [server](https://opencode.ai/docs/server/), and
  [Sign in with ChatGPT](https://help.openai.com/articles/20001542).
