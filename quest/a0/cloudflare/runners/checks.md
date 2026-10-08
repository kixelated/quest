# [M] Check changes with flake checks on trusted runners

## Goal

Every change gets a check job per system. A trusted runner builds the change's
flake `checks.<system>` with nix-fast-build, reading from the shared cache, and
records the result as a git note on the change's head commit. The change
shows pass or fail per system, and only trusted results count. Repositories
without a flake get `quest check` only.

## Plan

- Decided 2026-10-07: flake checks rather than a configured command, because
  they are hermetic and cacheable, and a project needs no CI config of its own.
- Each runner builds the systems it supports, so the Mac covers darwin.
- This replaces the earlier "checks run `quest check` from a push-triggered
  Workflow". The Sandbox runs checks only when no trusted runner is online.

## Required

- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - the job loop
- [Changes](/quest/a0/cloudflare/changes.md) - where check results show
