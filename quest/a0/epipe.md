# [XS] Exit quietly when stdout closes early

## Goal

`quest ready | head -1` and similar pipelines exit without a stack trace when
the reader closes the pipe. The CLI stops writing on `EPIPE` and exits with the
status the shell expects, for both the plain (piped) and themed (terminal)
output paths. A regression test covers it.

## Plan

Found on 2026-10-07 while building the themed CLI output (#77). The crash
already existed on the plain output path. Handle it once where the CLI writes
to stdout rather than in each command.
