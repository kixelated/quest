# [XS] Land squash merges, and review the final head

## Goal

Pull requests in this repository land as squash merges, and no pull request
merges with changes no review covered, other than merges from its base or a
reviewer's own suggested patch applied unchanged.

## Plan

Decided 2026-10-22 (user) from a merge wave in which
[kixelated/quest#189](https://github.com/kixelated/quest/pull/189) landed as
a merge commit, and [#183](https://github.com/kixelated/quest/pull/183),
[#185](https://github.com/kixelated/quest/pull/185),
[#188](https://github.com/kixelated/quest/pull/188),
[#189](https://github.com/kixelated/quest/pull/189), and
[#190](https://github.com/kixelated/quest/pull/190) merged with fixes pushed
after their last review, up to about 150 lines and including #188's security
rework. The user asked for these root-instruction, guide, and setting changes
through this plan.

- **Squash (user).** Add a line to this repository's root `AGENTS.md` saying
  pull requests land as squash merges; the merge skill picks
  `quest merge --land --squash` from it. Also set the repository to allow
  only squash merges (`allow_merge_commit` and `allow_rebase_merge` false,
  through `gh api`), approved by the user on 2026-10-22, so a wrong method
  fails instead of landing. Rejected: either one alone.
- **Re-review (user).** Tighten the guide's Reviews section in
  `assets/AGENTS.md`: "trivial changes since the last review" means only
  merges from the base or a reviewer's suggested patch applied unchanged.
  Any other change waits for a review of the head; if none arrives within
  the merge skill's wait bound, the agent asks the user instead of merging.
  Rejected: re-review on every head, and leaving "trivial" to the agent.
- Ranked first in the epic: prose and one setting, and it stops unreviewed
  merges now.
