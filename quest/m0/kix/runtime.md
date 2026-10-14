# [L] Run resumable Claude Agent SDK sessions

## Goal

A portable executor runs an authorized Quest workflow using the Claude
Agent SDK in an isolated worktree/container. It streams progress, emits
structured interactive questions, resumes from recorded answers, and returns
validated results. The hosted service can run it without exposing provider
or GitHub App credentials to repository code.

## Plan

- Claude Agent SDK is the first backend. Keep execution/provider code out of
  the pure core and reuse it for the later standalone API-worker CLI.
- Use the existing guide and skills as workflow sources. Explicitly load
  applicable repository instructions, including AGENTS.md; do not assume
  SDK CLAUDE.md support covers them. Keep shared transport behavior in the
  guide and workflow-specific behavior in its skill instead of copying prose.
- Validate workflow discovery and initialization. An unknown slash command
  may be treated as ordinary text, so a successful SDK call alone does not
  prove the requested workflow ran.
- Planning may inspect the repository and prepare quest changes. A trusted
  publication boundary enforces the workflow's permitted output and remote
  actions; prompt text is not the security boundary.
- Route `AskUserQuestion` or an equivalent structured question tool to the
  UI. Persist the whole decision round and exact session ID. Suspend/defer
  when waiting so the service need not keep a container running indefinitely.
  Resume preserves both session data and its matching worktree revision.
- Explicitly configure tools, settings sources, and permissions. SDK
  `allowedTools` is not a deny-by-default tool list; permission callbacks
  do not intercept every preapproved action.
- Return distinct completed, needs-decision, budget-stopped, cancelled, and
  failed outcomes. Validate structured output; never label an SDK-level
  success as a completed quest without checking its actual result.
- Supply a clean per-process environment and job-scoped API proxy credential.
  Preserve needed runtime variables without inheriting conflicting provider
  routing/authentication or every local secret.
- Use Cloudflare Sandbox as the initial hosted adapter, running a Linux
  image containing the native SDK executable and required tooling.
  Workers isolates cannot spawn that executable. Verify SDK packaging,
  container lifetime, cancellation, and filesystem/session persistence
  rather than assuming a process keeps a sandbox alive.
- Honor each repository's setup and checks. Nix is optional per repository;
  unsupported environments produce an actionable blocked result rather than
  a false success. Keep secrets outside project setup/build processes.
- Sources:
  [SDK input](https://code.claude.com/docs/en/agent-sdk/user-input),
  [SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions),
  [Cloudflare Claude example](https://developers.cloudflare.com/sandbox/coding-agents/claude-code/),
  and [Sandbox lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/).

## Required

- [Job coordination](/quest/m0/kix/jobs.md) - authorization, lifecycle, and executor contract
