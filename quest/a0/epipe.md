# [XS] Exit quietly when stdout closes early

## Goal

`quest ready | head -1` and similar pipelines exit without a stack trace when
the reader closes the pipe. The CLI stops writing on `EPIPE` and exits with
status 0. A regression test covers it.

## Plan

Found on 2026-10-07 while building the themed CLI output (#77). The crash
predates it: `src/cli/bin.ts` passes `process.stdout.write` through with no
`EPIPE` handling. Handle it once there rather than in each command.
`ready | head -1` only crashes sometimes, since `ready` writes once per line,
so the test should use a reader that closes at once, such as `true`.
