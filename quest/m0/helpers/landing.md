# [S] Land only heads tested against the current base

## Goal

A PR lands only on a head that contains the base branch as it is at landing
time, and the merge skill stops for the user, rather than waiting again, when
a required review of a changed head does not arrive. The merge skill, iterate,
and complete share one definition of the design checkpoint.

## Plan

Decided 2026-10-24 (user) from the merge wave that landed
[kixelated/quest#205](https://github.com/kixelated/quest/pull/205) through
[#219](https://github.com/kixelated/quest/pull/219). The user asked for these
skill and guide edits through this plan.

- **Refuse a stale head (user).** GitHub reported
  [kixelated/quest#213](https://github.com/kixelated/quest/pull/213) clean,
  but landing it would have broken a test #205 had just added. `quest merge
  --land <sha>` refuses when the head does not contain the base branch's
  current tip, naming both. The merge skill then merges the base (never
  rebasing), reruns the repository's checks, and lands the new head; a
  conflict-free base merge still needs no new review. Rejected: skill prose
  alone, and GitHub's "require branches to be up to date" protection.
  GitHub merge queues need an organization-owned repository, which
  kixelated/quest is not.
- **Ask on a missing review.** `assets/skills/merge.md` says to rerun
  `quest wait` with `--since` after a timeout. When the wait is for a
  required review of a changed head, ask the user instead, as the guide's
  Reviews section already says
  ([kixelated/quest#206](https://github.com/kixelated/quest/pull/206)).
- **One checkpoint.** Move the every-fourth-round design checkpoint that
  [kixelated/quest#207](https://github.com/kixelated/quest/pull/207) wrote
  into both `merge` and `iterate` into the guide's Reviews section, and point
  `merge`, `iterate`, and `complete` at it.
- Test a stale head refused, the same head landing after a base merge, and a
  head the base already contains.
