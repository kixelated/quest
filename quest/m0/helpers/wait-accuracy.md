# [S] Report reviews and checks accurately in wait and status

## Goal

`quest wait` wakes when a bot edits its review-status comment and never
reports a failed check under `checks:passed`, and `quest status` prints how
many review rounds a PR has had since its last `Design change:` comment.

## Plan

Decided 2026-10-24 (user) from the merge wave that landed
[kixelated/quest#205](https://github.com/kixelated/quest/pull/205) through
[#219](https://github.com/kixelated/quest/pull/219):

- **Edited bot comments.** Codex reports a finished or stuck review by
  editing its summary comment. `quest wait` did not wake on those edits, so
  agents on [#213](https://github.com/kixelated/quest/pull/213) and
  [#219](https://github.com/kixelated/quest/pull/219) read the comment by
  hand after each wait. Report an edit as an event.
- **Honest `checks:passed`.** On
  [#207](https://github.com/kixelated/quest/pull/207), `quest wait` printed
  `checks:passed native_Windows_(windows-11-arm)` six seconds after that
  optional job failed: the event covers the required checks but is labelled
  with the last check to finish. Name what passed, and report a failed
  optional check separately.
- **Review rounds.** `quest status` prints the number of pushed heads that
  drew reviews since the last `Design change:` comment, which the merge
  skill's design checkpoint counts today with `gh pr view --json`.
- Dropped (user): removing the `quest:merge` label after a PR merges; holds
  only count on open PRs, so the leftover label is cosmetic.
