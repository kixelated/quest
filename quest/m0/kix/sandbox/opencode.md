# [M] Sandbox opencode jobs' commands

## Goal

opencode jobs' commands run inside the same boundary as Claude Code's: writes
only to the checkout and the attempt's private directory, network only to
the policy's hosts, and no read access to account logins or other homes.

## Plan

Decided 2026-10-15: opencode has no native sandbox, so run `opencode serve`
under Anthropic's sandbox-runtime with the runner's `Sandbox` policy
(`src/runner/sandbox.ts`). Today its commands run unconfined on the host, in
the revision's devShell with the attempt's private HOME.

- The runner reaches the server on localhost, and opencode needs its
  providers' hosts, so check both under sandbox-runtime's network isolation.
- Keep the account's login out of what the commands can read: verify how
  much of its XDG home the wrapped process exposes, and deny reads of every
  other account home.
- Commands inherit the per-turn `OPENCODE_SERVER_PASSWORD`, and the kix
  tools' bearer token in `OPENCODE_CONFIG_CONTENT`; keep both out of reach.
- Rerun the hostile-repository boundary test from
  [kixelated/quest#212](https://github.com/kixelated/quest/pull/212) against
  an opencode account, and update the README's residual-risk note.
