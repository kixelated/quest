# [M] Add init and uninstall

## Goal

`quest init` sets up a repository for Quest and `quest uninstall` reverses it,
touching only what init owns. Both are idempotent and print what they changed.

## Plan

- init writes: a skill stub per shipped skill in `.claude/skills/` and
  `.agents/skills/` (a directory symlink between them where one already
  exists), a `quest/README.md` root if none exists, `/.scratch/` in
  `.gitignore`, and one reference line appended to the root `AGENTS.md` (or
  `CLAUDE.md` when that is the file present) telling agents to run
  `quest guide` when work mentions a quest.
- It refuses to overwrite a same-named skill that is not a Quest stub, rather
  than guessing.
- uninstall removes stubs that still match byte-for-byte, the reference line,
  and the ignore entry. It never deletes the quest tree: the export skill and
  git history are how plans leave.
- There is no `upgrade` command: stubs are version-independent, so upgrading is
  bumping the version in mise or the flake.
- Replace `docs/getting-started.md`'s submodule instructions with init.

## Required

- [Embedded skills](/quest/m0/embedded-skills.md) - init writes the stubs it defines
