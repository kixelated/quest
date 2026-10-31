# [S] Review handles expired logins

## Goal

When a reviewer CLI's login has expired or been revoked, `quest review` fails
with the same "`<harness>` is not logged in; run `<login>`" error it gives a
signed-out CLI, instead of a raw 401 from the reviewer's turn.

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
