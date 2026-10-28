# [M] The gate owns its command's descendants

## Goal

`quest gate` owns every descendant of the command it admits, on Linux and
macOS, in any checkout rather than only a Quest-registered one. Cancelling the
gate (SIGINT, SIGTERM, or SIGHUP) leaves no descendant alive, including ones
that left its process group, and the command's exit status still propagates.
A test cancels an admitted command whose grandchild must not survive, on both
platforms.

## Plan

Today `src/cli/gate.ts` says "The gate owns no descendants": it forwards a
signal only to its immediate child, and `quest worktree run` owns descendants
only in Linux systemd scopes of a registered checkout. moq.pro wants its
`just check`/`just test` phases to share host capacity through the gate, and a
cancelled run must leave no stack behind.

Decided 2026-10-25 (maintainer): m1, since only moq.pro's local gate adoption
waits on it. Best-effort PID traversal does not count. If only a narrower
contract is possible on macOS (for example, not following processes that leave
the session), state it in the gate docs.

Assessment 2026-10-27: the existing Linux `systemdScopes` backend works from an
arbitrary checkout and preserves the command's exit status. Reuse its
handshake and cgroup ownership; do not fall back to PID traversal or process
groups on Linux when that backend is unavailable.

Implementation waits for
[kixelated/quest#254](https://github.com/kixelated/quest/pull/254), which changes
the same `Scopes.run` API to accept optional protocol IO and an environment.
After it lands, propose one shared options shape that also accepts an
`AbortSignal` while retaining inherited streams when no protocol consumer is
supplied. The gate needs both its nested-admission environment and cancellation
of the owned scope, rather than forwarding only to its immediate child. Do not
start a competing backend rewrite or add a compatibility layer before that
dependency lands. The gate itself remains unchanged.

For macOS, document the narrower supported ownership contract and test it
explicitly. Apple's
[XNU event definitions](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h)
say fork-following `NOTE_TRACK` is unsupported since macOS 10.5, and its
[launchd contract](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5)
cleans up only the job's process group. A private process group is the proposed
boundary; descendants that change group or session would be outside that
macOS guarantee. Keep the stronger Linux cgroup guarantee and wire live
cancellation regressions into CI on both platforms before marking this done.

## Required

- [Codex agents release their checkouts](/quest/m0/codex-checkouts.md) - land the shared scope IO API before extending its cancellation options
