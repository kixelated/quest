# [S] Guide and skill rules agents kept needing

## Goal

Agents stop needing the same corrections from the maintainer, because the
guide and skills state them: who may push to a branch, what a brief carries,
where follow-ups go, whose review counts, which choices are the user's, and
searching for duplicates before planning. Each rule comes from steering the
moq maintainer typed repeatedly over a month of transcripts.

Non-goals: CLI changes, and restating repository rules; a repository's own
instructions keep owning its merge, review, and decision policy.

## Plan

Decided 2026-10-21 (user), from that audit. Each finding was checked against
the skill text on `main` that day. The user asked for these guide and skill
edits through this plan; follow `PROMPTING.md` (goals over prescriptions).

- Pushing (guide): never rebase or force-push a branch another session may
  hold, and confirm the PR is still open before every push, because a push
  after the merge brings the deleted branch back.
- Briefs (`spawn`, `complete`): a sub-agent's brief carries the quest or PR,
  the user's picks, and the scope, and leaves repository rules to that
  repository's own instructions instead of restating them.
- Planning (`plan`): search the quest tree, git history for deleted quests,
  and open PRs touching `quest/` before anything else, and show any overlap in
  the first round. The maintainer asked "double check we don't already have
  it" and "I thought I had a probe quest already?".
- Audit (`audit`): moving a quest between milestones or changing its rank is
  always the user's decision, never a factual correction. "Apply factual
  corrections" was read as permission to move quests, and the move was
  reverted.
- Follow-ups (guide): a follow-up becomes a quest through `/quest-plan`,
  never a session task card or a GitHub issue.
- Reviews (guide): "At least one review is required" defers to the
  repository's review policy for whose review counts. A review by the PR's
  author, or an AI-attributed comment posted from the maintainer's account,
  does not count.
- Decisions (`iterate`): a sub-agent that cannot prompt picks the
  recommended option only for decisions the repository's instructions don't
  reserve for the maintainer (moq reserves API shape, naming, and scope);
  the rest stay open in the PR.
- Dropped (user): filtering CodeRabbit rate-limit and Codex "review started"
  notices in `quest wait`. Vendor-specific filters break the core's
  independence and the helpers' "the agent decides which result counts"
  non-goal; the merge skill already re-waits on bot notices.

## Related

- [quest start](/quest/m0/helpers/start.md) - carries the ready-at-hand-back fix from the same audit
- [PR state commands](/quest/m0/helpers/pr-states.md) - refuses a merged PR mechanically and carries the merge method
- [Unattended work](/quest/m0/helpers/afk.md) - the guide's final-summary rule
