# [S] Verify quest runner on live machines

## Goal

`quest runner` (`src/runner/`) works against the deployed kix.quest on a real
Linux and macOS machine: a login approved at `/runners`, two Claude Code
accounts signed in side by side, and a job that checkpoints, asks, resumes,
delivers its pull request, and continues on another runner after its first one
goes offline. The opencode adapter follows in
[opencode](/quest/m0/kix/opencode.md).

## Plan

Shipped: `quest runner login|account|run`, the Claude Code adapter
(`claude -p` stream-json with the kix `checkpoint`, `ask`, and `deliver` tools
as an HTTP MCP server and AskUserQuestion disabled), per-job checkouts in a
bare clone, publication of changed files, raw output chunks, account limits
held until the reported reset, shutdown that publishes running work and gives
jobs back, the flake's `runner` package pinning Claude Code, and the
`/runners` page with login approval and account preference order. Verified
locally on 2026-10-21: a Max plan login runs the unmodified binary headless,
lists only the kix tools, and resumes a session with an answer.

What remains needs live machines:

- On macOS, check that two accounts in separate `CLAUDE_CONFIG_DIR` homes keep
  separate Keychain credentials, and that `claude auth status --json` reports
  each one's own `authMethod` and email.
- Check that `git fetch <upstream> <sha>` reaches a commit kix published on
  the service fork, which a reassigned job's new runner relies on. If GitHub
  refuses it, have the hub send the fork's clone URL with `assign`.
- Check that a rejected `rate_limit_event` and its `resetsAt` arrive when a
  plan runs out, so the account sits out until its reset instead of the
  one-hour fallback.
- Run the flow above against kix.quest once [deploy](/quest/m0/kix/deploy.md)
  lands, and fix what it finds.

## Related

- [Worktree removal](/quest/m0/worktree.md) - `quest worktree run` could supervise each job's agent and admit its disk, on Linux hosts with systemd
- [Job sandbox](/quest/m0/kix/sandbox.md) - replaces `bypassPermissions` and the trusted-revisions-only rule
