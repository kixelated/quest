---
description: Plan a quest that repeats, such as a periodic audit or a release cut. Use when the user invokes /quest-recurring or wants the same work redone each milestone or release.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

Run the plan interview for a quest that recurs: the PR that finishes one occurrence creates the next.
The argument (if provided) is the work to repeat, or an existing quest to make recurring.

Agents working the quest never load this skill, so the quest carries its own recurrence.
Its Plan says, in its own words, where the finishing PR adds the next occurrence, what gates it, and that it is linked from its parent's `Required`, creating any missing milestone or parent epic along with its link.
The next occurrence keeps the Goal and recurrence, and its Plan carries forward what this occurrence learned (baselines, results, what to check first).

Also settle in the interview:

- How the tree's milestones advance. If they only grow, the next occurrence takes the same path below the next milestone (`m1/perf/audit.md` to `m2/perf/audit.md`). If they are priority tiers that shift up after a release, it goes where the next run belongs after the shift.
- What gates the next occurrence. Rank orders work but doesn't delay it: a quest without `Required` is ready at once, and `/quest-spawn` starts it right after the last run. Gate it on another recurring quest (such as a release cut) or on a condition quest (a date, an outside event) as the guide describes. A quest can't require the milestone that lists it, so to run at the end of mN, the gate requires mN and the next occurrence requires the gate.
- What each occurrence delivers, what it carries forward, where it ranks, and whether anything ends the recurrence.

A quest re-created at its own path never clears for the quests that require it.
So when a recurring quest is itself a gate, its Plan says its finishing PR removes its path from every `Required` before re-creating it.
Findings that need their own work are follow-ups for `/quest-plan`, not part of the recurring quest.
