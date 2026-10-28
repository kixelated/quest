# [XS] Keep agent tests independent of the caller's agent

## Goal

`just test` passes inside a Claude Code or Codex session. `test/agent.test.ts`
clears the caller's agent variables (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_*`,
`CODEX_*`) before it compares the environment it launches with.

## Plan

Decided 2026-10-28 (user, /quest-plan of the follow-ups from a 25-PR /quest-complete run). Almost every merge agent in that run had to unset `CLAUDE_CONFIG_DIR`
before `just test` would pass, because the launched agent's expected
environment picked it up. Decide whether the launch itself should strip any
of these variables or only the test should. Name that choice in the PR.
