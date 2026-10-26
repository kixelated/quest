---
description: Scope and create quests through an interactive interview. Use when the user invokes /quest-plan, asks to plan a quest, or wants unsettled work split into quests.
---

Before you begin, run `quest guide` and `quest skill grill`, and read their output completely.

Before anything else, search for existing work: the quest tree, git history for deleted quests, and open PRs touching `quest/`.
Show any overlap in the first round.

Interview the user with the grill skill.
Every follow-up the user picks goes through this interview, including edits to existing quests and to quests in other repositories.
A background agent that cannot prompt never creates or edits quests itself, so this skill can run in the foreground.

Search other quests and epics to keep the larger plan consistent.
When the work changes what a user sees (a wire, an API, a flag, a dashboard), ask whether it needs documentation the feature quest cannot carry inline (a new page or guide), and recommend a quest for that; docs a change makes stale stay in that change.

Begin the interview by scoping the goal: the observable outcome, why it matters, and its important boundaries and non-goals.
Restate the goal in one sentence and get it confirmed before moving on to implementation decisions.
If the goal contains independently completable outcomes, split them before planning.

The result may be one quest or multiple quests and epics, split based on what can be completed independently.
Prefix each quest title with `[XS]`, `[S]`, `[M]`, `[L]`, or `[XL]`, including implementation, verification, and landing work.
Once complete, create, update, or delete the relevant quests and epics.
Record each settled decision and its reason in the quest's Plan, so later sessions don't ask it again, and the decision prompts in the PR.
New work joins the milestone matching its priority, at its rank; an epic groups related quests, and its README holds the work no child owns (the end-to-end test, the docs page).

When done, commit, open the PR ready for review, and run `/quest-merge` on it.
Quests planned as follow-ups of an open PR may be committed to that PR instead.
The quest should be reviewed before it is merged.
