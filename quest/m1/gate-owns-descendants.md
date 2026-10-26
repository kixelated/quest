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
