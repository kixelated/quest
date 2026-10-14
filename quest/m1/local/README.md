# Local integrations

## Goal

People can run Quest with explicit API funding from a CLI, or use their
normal local Claude Code session through a plugin. Local contributors can
offer execution capacity to opted-in projects.

## Plan

Decided 2026-10-13: ship after the hosted decision UI. Reuse its portable
executor and job contract; keep local subscription sessions distinct from
API-funded SDK processes. No hosted service borrows Claude login tokens.

## Required

- [API worker CLI](/quest/m1/local/api-worker.md) - explicit account selection and one-shot SDK workers
- [API workflow skills](/quest/m1/local/api-skills.md) - spawn and complete using processes rather than native subagents
- [Claude Code plugin](/quest/m1/local/claude-plugin.md) - local sessions using the maintainer's existing account
- [Local donor runner](/quest/m1/local/donor-runner.md) - contribute API-funded execution capacity
