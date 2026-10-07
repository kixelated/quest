# [XS] Make init refuse before writing on path-type conflicts

## Goal

`quest init` refuses before writing anything whenever it can't finish,
including when `.agents`, `.claude`, or `quest` is a regular file, or
`AGENTS.md` is a directory. A refused init leaves the repository byte-for-byte
unchanged, and `scripts/lifecycle-check.sh` proves it for these cases.

## Plan

Decided on 2026-10-07, from the review of kixelated/quest#82. That PR made init
check every stub before its first write, which covers skill conflicts. These
path-type cases still fail partway through, as they already did before #82.
Treat a path under a regular file (`ENOTDIR`) and other wrong-type paths as
conflicts in the up-front check. They're rare, so this doesn't block v0.1.0.
