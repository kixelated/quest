# [XS] Make init refuse before writing on path-type conflicts

## Goal

`quest init` refuses before writing anything whenever it can't finish,
including when `quest` is a regular file, `.agents` is a regular file, or
`AGENTS.md` is a directory or dangling symlink and there's no `CLAUDE.md`. A
refused init names the path and leaves the repository byte-for-byte unchanged,
and tests prove it for these cases.

## Plan

Decided on 2026-10-07, from the review of kixelated/quest#82. That PR made init
check every stub before its first write, which covers skill conflicts. These
path-type cases still fail partway through, as they already did before #82.
Treat a path under a regular file (`ENOTDIR`) and other wrong-type paths as
conflicts in the up-front check. `.claude` as a regular file already fails
before writing, but with a raw `ENOTDIR`; refuse it with the same message.
`test/init.test.ts` ("a refused init writes nothing") is a cheaper home for
most cases than `scripts/lifecycle-check.sh`, which runs on six runners.
They're rare, so this doesn't block v0.1.0.
