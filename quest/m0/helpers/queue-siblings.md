# [S] Sibling quest PRs land through a server-side merge

## Goal

Several PRs that each finish a child of the same epic land back to back
through a server-side merge, such as a GitHub merge queue, without each
landing knocking the next one out on a conflict in the epic's link list, or
on a `quest check` failure over a quest the base just finished.

## Plan

Decided 2026-10-25 (user), from a moq-dev/moq merge wave. Nine
test-flake PRs each deleted their own line from one epic README's
`Required` list. The local `quest` merge driver resolves those edits, but
GitHub's merge queue builds its merge commit without it. Each landing
conflicted with the next queued sibling, which cost four extra
drop, merge, and re-land cycles in one batch.

A second symptom: a quest-only PR waiting in the queue fails `quest check`
once main finishes a quest it links. moq-dev/moq#6707 was dropped 3 times
and moq-dev/moq#6790 4 times. Options: run `quest check` against current
main before queueing, or have the check treat a link to a deleted quest as
resolvable.

The fix belongs in quest, not in each repository's process. Rejected:
landing one sibling at a time, which serializes batches.

Open (this quest decides, with a recommendation to the user):

- Change the link-list format so deleting one entry never touches its
  neighbors' lines in a 3-way merge.
- Or keep the finishing PR's diff off the shared parent list. Example: drop
  the link in a later pass, or have `quest check` treat a link to a deleted
  child as done rather than broken.
- Or have `quest merge --land` merge the base locally with the driver and
  re-land when the queue drops a PR only for a link-list conflict.

Whatever it picks must keep `quest check`'s rule that a finished quest leaves
no dangling reference once all siblings land. Test it with two sibling PRs
landing through a merge that does not run the driver.

## Related

- [Land only heads tested against the current base](/quest/m0/helpers/landing.md) - the same landing path
