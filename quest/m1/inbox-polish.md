# [S] Expire old follow-up offers

## Goal

Old "plan these?" offers expire by age, so a quiet project does not keep stale
suggestions indefinitely and a busy project does not hide recent suggestions
just because it has more than 50.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#215](https://github.com/kixelated/quest/pull/215) and
[kixelated/quest#205](https://github.com/kixelated/quest/pull/205), ranked
after launch:

The live cards, active quest status, and runner choice portions are implemented
in [kixelated/quest#258](https://github.com/kixelated/quest/pull/258). The remaining
work is age-based expiry of "plan these?" offers, which are currently capped at
the newest 50 per project.

The expiry duration remains undecided: the recorded plan and existing offer
lifecycle do not specify one. Choose it before implementation. A recommendation
is 30 days from the completed job's offer, with 7 days for a short decision queue
or 90 days for infrequent project visits as alternatives. Expiry should hide the
offer and reject its stale planning form without deleting the completed job's
history. Replace the newest-50 cutoff with the chosen age policy.
