# [M] Add API-backed spawn and complete workflows

## Goal

A user invokes `quest-spawn-api` or `quest-complete-api` to make the usual
foreground decisions, then launch selected work through the API-worker CLI
instead of the host's native subagents.

## Plan

- User explicitly requested an API variant on 2026-10-13. Keep account and
  budget selection explicit, including multiple Claude accounts.
- Make variants thin transport selectors. Share normal workflow behavior;
  keep shared rules in assets/AGENTS.md and particular behavior in skills.
  Do not copy entire spawn/complete instructions into another implementation.
- Relay progress, decisions needed, and final results to the foreground.
  A worker does not silently decide a consequential question or select merges.
- Register skills in the CLI's discovery and generated stubs and test their
  availability; unknown SDK slash commands must not degrade to ordinary text.

## Required

- [API worker CLI](/quest/m1/local/api-worker.md) - process transport and result contract
