# [S] Review handles expired and environment logins

## Goal

When a reviewer CLI's login has expired or been revoked, `quest review` fails
with the same "`<harness>` is not logged in; run `<login>`" error it gives a
signed-out CLI, instead of a raw 401 from the reviewer's turn. A reviewer
whose only credentials come from the environment still reviews.

## Plan

Decided 2026-10-29 (user, /quest-plan of the follow-ups from
[kixelated/rind#31](https://github.com/kixelated/rind/pull/31)), where
`codex login status` exited 0 on a revoked token
(`refresh_token_invalidated`) and every review turn then failed with a 401.

- Map the failure, don't probe: when `turn` in `src/cli/review.ts` fails on
  an authentication error (a 401, or a revoked or expired token), raise the
  `ReviewInputError` the status check raises. This costs no extra request and
  covers Claude Code too.
- Keep the `status` check for the signed-out case.
- Cover it with the fake-CLI tests: one reviewer that exits with each CLI's
  auth error text.

Decided 2026-10-30 (user, /quest-plan of the follow-ups from a moq-dev/moq
`/quest-complete` session): ✅ extend this quest / drop.

- `quest review --harness claude` reported "claude is not logged in" in
  sessions where Claude Code's credentials came only from `ANTHROPIC_*` or
  `CLAUDE*` variables. `strippedEnvironment` (`src/cli/agent.ts`, used at
  `src/cli/review.ts`'s status check) removes every one except
  `CLAUDE_CONFIG_DIR`, so the status check fails. Codex-written PRs then got
  no Claude review (moq-dev/moq#7084, moq-dev/moq#7251).
- Let a reviewer keep the credential its own CLI would read from the
  environment, while still stripping variables that would redirect billing or
  configuration. Weigh that against why `STRIPPED` exists before choosing
  which names pass. If a credential is stripped on purpose, the error names the
  variable instead of saying "not logged in".
- Test with a fake reviewer that authenticates only through an environment
  variable.
