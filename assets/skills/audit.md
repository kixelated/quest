---
description: Audit outstanding quests for disagreements, conflicts, misaligned priorities, and stale plans, then resolve them with /quest-plan. Use when the user invokes /quest-audit or asks to check the quest tree for consistency.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

The goal is a quest tree that agrees with itself and the code, ordered by priority.
The scope is every outstanding quest; the argument (if provided) filters it to specific quests or epics.

Look for:
- Disagreements: quests whose goals or plans contradict each other, the code, or the repository's docs.
- Conflicts: quests that would change the same code or interface incompatibly, or that must land in order without a `Required` link.
- Misaligned priorities: a quest ranked or placed in a chapter ahead of work it depends on, or behind work it blocks.
- Stale plans: work already done, blockers that have cleared, or references to code that no longer exists.

The audit is read-only.
Split the reading across parallel sub-agents, each given a slice of the scope and returning its findings with evidence (a path, line, or commit).

Report each finding with the quests involved, the evidence, and a recommended resolution; recommendations are not decisions.
Then run `/quest-plan` with the findings as its first frontier.
