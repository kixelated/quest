# [M] Rank ready work by downstream impact

## Goal

`quest unblocked` prints the highest-impact ready quests, with their paths and
counts of distinct transitive dependents. `quest-spawn` prioritizes that order
within each milestone while retaining claim and conflict checks.

## Plan

- Decided 2026-10-15: rank by all transitive dependents, not only quests that
  become immediately ready when one prerequisite finishes. The output must
  explain that other prerequisites may remain.
- Milestone priority comes first, descending downstream count second, and
  existing tree order breaks ties. Count dependents across the tree, including
  later milestones, without promoting their candidate quests ahead of an
  earlier milestone. Explicit user selection still takes precedence.
- Reuse `ready` and the parsed `Required` graph. Count each dependent once,
  including diamond-shaped dependencies, and never count the candidate itself.
  Structural root/milestone/epic membership must not inflate the score; still
  resolve real dependencies on an epic through its remaining work.
- Keep `quest ready`'s existing contract. Provide clear terminal output and a
  deterministic machine-readable form for `quest-spawn`, with a way to limit
  the result. Invalid graphs fail explicitly rather than producing a ranking
  that looks authoritative.
- The command stays local and deterministic. Readiness does not prove a quest
  is unclaimed or its external condition has cleared; the spawning workflow
  still verifies those before starting and recomputes as the tree changes.
- Cover chains, shared blockers, diamonds, epic dependencies, milestone order,
  ties, and zero-impact ready quests. Update CLI examples and the spawn skill
  together. Existing docs carry the explanation; no separate guide is needed.

## Related

- [Web execution](/quest/m0/kix/execution.md) - inherit the same spawn ordering
