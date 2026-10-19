---
description: Plan a quest that repeats every milestone, such as a periodic audit. Use when the user invokes /quest-recurring or wants the same work redone each milestone.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

Run the plan interview for a quest that recurs: once it finishes, the same quest is created in the next milestone.
The argument (if provided) is the work to repeat, or an existing quest to make recurring.

Agents working the quest never load this skill, so the quest carries its own recurrence.
Its Plan says, in its own words, that the PR finishing it also adds the next occurrence at the same path below the next milestone (`m1/perf/audit.md` to `m2/perf/audit.md`), linked from its parent's `Required`, creating the milestone or any missing parent epic along with its link.
The next occurrence keeps the Goal and recurrence, and its Plan carries forward what this occurrence learned (baselines, results, what to check first).

Also settle in the interview what each occurrence delivers, what it carries forward, where it ranks in its milestone, and whether anything ends the recurrence.
Findings that need their own work are follow-ups for `/quest-plan`, not part of the recurring quest.
