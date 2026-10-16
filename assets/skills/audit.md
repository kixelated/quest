---
description: Audit and fix outstanding quests for disagreements, conflicts, misaligned priorities, and stale plans. Use when the user invokes /quest-audit or asks to check the quest tree for consistency.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

The goal is a quest tree that agrees with itself and the code, ordered by priority.
The scope is every outstanding quest; the argument (if provided) filters it to specific quests or epics.

Look for:
- Disagreements: quests whose goals or plans contradict each other, the code, or the repository's docs.
- Conflicts: quests that would change the same code or interface incompatibly, or that must land in order without a `Required` link.
- Misaligned priorities: a quest ranked or placed in a milestone ahead of work it depends on, or behind work it blocks.
- Stale plans: work already done, blockers that have cleared, or references to code that no longer exists.

Split the reading across parallel sub-agents, each given a slice of the scope and returning its findings with evidence (a path, line, or commit).

Apply factual corrections and changes the user has already decided. Use `/quest-plan` only for unresolved scope, priority, API, or other consequential choices; recommendations are not decisions. Once those choices are settled, apply them without another approval round.

Update every reference and dependency affected by a move or deletion, run `quest check`, and follow the repository's PR workflow. Report the changes with their evidence and any decisions still open. An explicit read-only audit request leaves the tree unchanged.
