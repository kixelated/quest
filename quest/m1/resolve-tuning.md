# [S] Measure and refine the quest merge driver

## Goal

The `quest resolve` merge driver's real effect is measured on an agreed,
reproducible corpus of moq-dev/moq's merge history.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#219](https://github.com/kixelated/quest/pull/219), ranked
after launch:

- **Replay decision.** The original plan records 280 merges (128 conflicted,
  29 quest-only) but no merge SHA list or ref snapshot. Supply that corpus,
  or accept the explicitly proposed replacement measured in
  [kixelated/quest#256](https://github.com/kixelated/quest/pull/256).
  Do not describe the replacement as a replay of the original 280.

Checkpoint in that PR: marker labels and size are implemented, including the
ancestor label and native fallback. A proposed replacement selects two-parent
merges reachable from the recorded local heads, committed from
2026-09-23T00:00:00-07:00 through 2026-10-23T09:11:00-07:00, whose second
parent is on the first-parent chain of main snapshot
`bea4214598a6b3b2419dd59ce7f8ea44837ca3f8`. Its full merge SHA list is retained
in the PR. Of 1,108 merges, 642 conflict natively and 220 conflict only in
`quest/`; the driver resolves 111 of those 220 and leaves 109. Remaining
conflicts include prose edits and structural Git conflicts. These counts
measure mechanical conflict resolution, not the semantic correctness of
historical manual resolutions. No replacement corpus has been accepted yet.
