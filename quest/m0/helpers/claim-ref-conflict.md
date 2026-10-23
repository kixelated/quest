# [S] A branch named after an epic never blocks its claims

## Goal

Skill-made PR branches never take a name under a quest's claim namespace,
and `quest start` explains a claim push that a directory/file ref conflict
refuses: it names the blocking ref and whether it is a merged PR's head, and
tells the agent to stop and report rather than delete anything.

## Plan

Decided 2026-10-22 (user) from a moq-dev/moq.pro quest spawn. A planning PR
for the epic `quest/m1/mesh-gossip/` used the branch `quest/m1/mesh-gossip`,
the epic's directory path (the epic's own claim branch is
`quest/m1/mesh-gossip/README`). After it merged, the leftover ref made git
refuse every child claim (`quest/m1/mesh-gossip/baseline`): a ref can't be
both a branch and a directory. One agent deleted the merged branch without
asking, and auto mode then blocked it; another pushed its claim to a
non-standard `quest/m1/mesh-gossip-topology`, which other agents can't see as
a claim.

- Guide rule: only quest claims use the `quest/` prefix. Branches for
  `/quest-plan`, `/quest-audit`, and other skill PRs use a prefix of their
  own, such as `quest-plan/<slug>`.
- `quest start` (`src/cli/start.ts`): on a push refused by a ref conflict,
  find the conflicting ref (an ancestor path of the claim branch, or a
  descendant of it), say whether it is a merged PR's head
  (`src/cli/claims.ts` already reads that), and exit non-zero with that
  message. It never deletes or renames the ref.
- Rejected: flattening claim branches so none can nest, which touches every
  skill and existing claim.
- Regression test: a claim under a remote that holds the parent path as a
  branch fails with the blocking ref named, and leaves that ref in place.
