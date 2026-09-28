---
description: Audit outstanding quests for disagreements, conflicts, and misaligned priorities, then resolve them with /quest-plan.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

The scope is every outstanding quest, including those on questline branches.
Use the argument (if provided) to filter to specific quests/questlines.

Look for:
- Disagreements: quests whose goals or plans contradict each other, the code, or the repository's docs.
- Conflicts: quests that would change the same code or interface incompatibly, or that must land in order without a `Required` link.
- Misaligned priorities: a quest ranked or placed in a milestone ahead of work it depends on, or behind work it blocks.
- Stale plans: work already done, blockers that have cleared, or references to code that no longer exists.

Finding the facts is your job; dispatch sub-agents to read questlines and code in parallel.
Do not edit quests during the audit.

Report each finding with the quests involved, the evidence, and a recommended resolution.
Then run `/quest-plan` with the findings as its first frontier, so the user decides each resolution.
