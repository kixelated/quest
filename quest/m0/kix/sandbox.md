# [L] Sandbox every runner job

## Goal

Every job's commands run in an OS sandbox on the runner: writes only to the
job's worktree, network only to the provider, kix, and Nix substituters, and
no access to other account homes or the machine's secrets. Jobs on PR heads
containing non-maintainer commits route to Linux runners, which build the
PR's devShell in a per-job VM before its commands run in the sandbox.

## Plan

Decided 2026-10-15, from Codex's review of kixelated/quest#121:

- A Nix devShell is not an isolation boundary, and maintainers' machines
  must not run contributor-controlled code unconfined. Sandbox all jobs, not
  just untrusted ones: one execution path, which also contains prompt
  injection from untrusted issue text.
- OS sandbox, not a VM per job: bubblewrap on Linux and Seatbelt on macOS.
  Use Claude Code's built-in sandbox, and Anthropic's sandbox-runtime
  around opencode, which has no native sandbox. Claude Code's docs say this
  does not replace a container or VM; document that residual risk.
- Keep the agent CLI's login outside what sandboxed commands can read. For
  opencode under sandbox-runtime, verify how much of its account home the
  wrapped process exposes, and deny reads of every other account home.
- Job coordination marks every `iterate` job untrusted and routes it only to
  Linux runners that register with `vm: true`. Classify PR heads whose commits
  all come from maintainers or kix jobs as trusted here.
- Trusted revisions (the default branch, kix job branches, and maintainer
  commits) build their devShell through the host Nix daemon before entering
  the sandbox. Verify whether sandboxed commands such as `nix flake check`
  need daemon access, and allow it only for trusted revisions.
- Untrusted heads: evaluate and build the PR's own devShell in a per-job
  KVM microVM on a Linux runner, then bring the closure into the host store
  and run the job's commands in the OS sandbox without daemon access. Verify
  how to import unsigned paths without making the runner trust arbitrary
  builders, and never publish them to the shared cache.
- macOS runners take trusted revisions only, since a Linux VM cannot build a
  darwin devShell. An untrusted-head job waits with "needs a Linux runner"
  while none is online. Cloud runners are Linux-only.
- The devShell bootstrap job runs sandboxed in the runner's own pinned Nix
  environment.
- Test that the boundary stops writes outside the worktree, reading
  another account home or `~/.ssh`, network to unlisted hosts, and a PR
  whose shellHook or flake tries to run on the host.
- Sources:
  [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
  and [sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime).

## Required

- [Runner](/quest/m0/kix/runner.md) - the job execution path being sandboxed
