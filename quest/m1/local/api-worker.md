# [L] Run API-funded Agent SDK workers from the CLI

## Goal

A foreground agent or person launches an isolated Claude Agent SDK process
for a selected quest action, choosing the API account explicitly. The worker
reports progress and a final result or decision needed without requiring the
foreground host's native subagent API.

## Plan

- Reuse the portable hosted executor, shared guide, and workflow skills.
  Keep provider execution outside the pure core.
- Proposed interface: `quest worker start <quest-path>`,
  `quest worker iterate <pr>`, and `quest worker merge <pr>`, with
  `--api-key-env ENV_NAME` defaulting to `ANTHROPIC_API_KEY`. Support
  planning through the same executor when the CLI can relay its questions.
  Merge requires the foreground's explicit selection and repository checks.
- Read the chosen environment variable into that subprocess only; never
  accept literal keys as command-line arguments or mutate the parent's global
  environment. Preserve required execution environment such as PATH and
  exclude unrelated provider credentials. Verify the SDK's actual key source.
- Each worker owns an isolated worktree and exact session identity. Persist
  resumable state, distinguish success, blocked, cancelled, and failed results,
  and handle signals and missing terminal results. Preserve partial work.
- Expose an estimated per-run API budget and selected payer; do not promise
  promo-only spending or a strict cash cap from SDK maxBudgetUsd.
- Verify native Claude executable discovery and distribution for the standalone
  Bun binary on supported platforms; bundling the SDK import alone is insufficient.
- Keep README/help examples aligned with the actual interface. Test account
  separation, resume, cancellation, structured results, and packaged execution.

## Required

- [Agent SDK runtime](/quest/m0/kix/runtime.md) - the portable executor and structured session contract
