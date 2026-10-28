# [M] Land only reviewed heads

## Goal

kix lands a PR only when the exact head being landed has a review that counts
under the repository's review policy. This covers both an inbox merge and a
merge job's `land` publication. A maintainer's earlier merge pick alone never
lands a head that a runner published or changed since the last review. When
landing waits, kix says why.

## Plan

Decided 2026-10-28 (user, /quest-plan trust audit):

- Today a merge job lands a runner-published head on the maintainer's earlier
  pick, bounded only by branch rules. kixelated/quest's `main` requires no
  reviews, so nothing enforces the review policy at that point.
- Apply the guide's rule: a review counts only on the head being landed. The
  only exemptions are a conflict-free base merge and a reviewer's patch applied
  unchanged. Where a repository's policy names whose review counts (for
  kixelated/quest, a Codex review or 👍 on the head, in `CONTRIBUTING.md`),
  follow it. Otherwise require a review from someone other than the PR's
  author and the App.
- Where GitHub branch protection already requires reviews, defer to it rather
  than duplicating it.
- Test landing with a review of an older head, with a conflict-free base merge
  since the review, with a hand-resolved conflict since the review, and with
  only an AI comment from the author's account.

## Related

- [Web execution](/quest/m0/kix/execution.md) - merge jobs this rule gates
- [Require read-only pull-request CI](/quest/m0/kix/ci-read-only.md) - the trust model this completes
