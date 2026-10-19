# [XS] Move to the next decision after an answer

## Goal

After a maintainer answers a decision in the inbox, the page moves on to the
next active decision with a short "Answer recorded" notice. When an action is
refused, the page has a neutral title and says why, whatever the action was.

## Plan

Decided 2026-10-19 as a follow-up of the decision inbox (#144), which stays
on the item just answered, and titles every refusal "Not recorded" even for
a refused "Refresh from GitHub":

- Redirect to the next active decision, or to the inbox's empty state, and
  show the notice there. The answered item stays reachable under its
  earlier answers.
- Retitle the refused-action page neutrally (for example "Couldn't do
  that"), with the specific reason and a link back to the item.
- Keep the form posts working without JavaScript. Update the inbox tests.
