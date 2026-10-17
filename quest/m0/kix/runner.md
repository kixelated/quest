# [L] Run jobs on your own machines with quest runner

## Goal

A maintainer runs `quest runner` on any Linux or macOS machine, signs it in
to kix.quest, and adds any number of agent accounts. The runner shows online
or offline in the UI, claims routed jobs over HTTPS, runs each one inside the
project's `nix develop` shell through a CLI adapter, and reports structured
questions, checkpoint summaries, and results. The Claude Code adapter ships
here; [opencode](/quest/m0/kix/opencode.md) follows.

## Plan

Decided 2026-10-15 in the decisions-not-implementations interview,
replacing the hosted Agent SDK runtime:

- `quest runner` is a subcommand of the existing Bun binary, in its own
  module outside the pure core. It runs in the foreground or as a user
  service; a tray app can come later. There are no Windows runners.
- Accounts: each is signed in by the official CLI's own flow in an isolated
  home (`CLAUDE_CONFIG_DIR` for Claude Code). kix stores only an opaque
  account ID, provider, and kind (subscription or API key), and never reads,
  copies, or uploads tokens. Anthropic's terms allow an end user signing in
  to the unmodified Claude Code binary, and bar a developer routing plan
  credentials on users' behalf. Use the unmodified binary.
- Nix only: run every job in the project's `nix develop` shell, with no
  other dependency installation path. Pin the agent CLIs through the
  runner's own Nix closure so adapters run tested versions. Keep a persistent
  local `/nix/store` and honor the flake's `nixConfig` substituters.
- Adapter interface: start or resume, structured questions, checkpoint
  summaries, a final result with a required summary, and cancellation. Keep
  it small and portable; consider the Agent Client Protocol only if it
  simplifies the adapters. For Claude Code, verify which headless path
  (Agent SDK or `claude -p` stream-json) runs the unmodified binary with a
  plan login and routes `AskUserQuestion` to kix.
- Checkpoints: the agent calls a structured status tool at meaningful
  steps. The runner sends the summary and a work-in-progress bundle; the
  service publishes it to the job's fenced branch, so another runner can
  continue after reassignment. Runners never hold GitHub App credentials.
- Raw agent output is uploaded for retention behind the maintainer-only
  disclosure; it is never streamed to the UI by default.
- A job that hits an account limit pauses with a decision to switch
  accounts. The runner never rotates accounts automatically.
- Use the existing guide and skills as workflow sources. Explicitly load
  repository instructions, including AGENTS.md. Validate that the requested
  workflow actually ran; an unknown slash command may be treated as text.
- Return distinct completed, needs-decision, account-limited, cancelled,
  and failed outcomes. Never label a CLI-level success as a completed quest
  without checking its actual result.
- m0 runners run the owner's own projects only. Until the
  [sandbox](/quest/m0/kix/sandbox.md) ships, they run only trusted revisions:
  the default branch, and branches whose commits come from kix jobs or the
  project's maintainers. A Nix devShell is not an isolation boundary.
  Sharing a runner with other projects is [later work](/quest/m1/donor-runner.md).
- Sources:
  [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
  [authentication](https://code.claude.com/docs/en/authentication),
  [SDK input](https://code.claude.com/docs/en/agent-sdk/user-input),
  and [Agent Client Protocol](https://agentclientprotocol.com/overview/clients).
- Speak the job protocol in `cloudflare/src/jobs/protocol.ts`: register for a
  bearer token (`POST /api/runners`) and hold one WebSocket to
  `/api/runner/connect`. Send `status` messages (accounts, running attempts,
  free slots) when connecting and whenever they change; the first one on a
  connection must list every attempt still running. Take `assign` and
  `cancel` pushes, and stop any attempt the hub says is no longer this
  runner's or whose `checkpoint` or `question` reply says `cancel`. Acknowledge an `assign` by sending a status that lists it; the
  hub resends it until then, so treat a repeated assignment as one. Reconnect with backoff; running jobs move after two minutes
  away. Each account's opaque ID must stay stable across restarts so its
  preference rank and paused sessions follow it. A CLI sign-in flow and a
  control to reorder account preference remain here.

## Required

- [Recoverable worktrees](/quest/m0/worktree.md) - reuse checkout supervision, checkpoints, and disk admission
