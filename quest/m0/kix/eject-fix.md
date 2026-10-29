# [M] Fix ejected landings from the hook

## Goal

When `quest land` or GitHub's merge queue ejects a PR the maintainer picked to
merge for `merge_conflict` or `failed_checks`, kix starts a fresh merge job from
the ejection webhook. The job fixes an easy conflict or failure and lands the
head again. Otherwise it labels the PR and puts the decision in the
maintainer's inbox. No agent stays alive waiting on the queue.

## Plan

Decided 2026-10-29 (user): the merge bot owns the queue, and short-lived jobs
started by hooks replace long-running agents waiting on GitHub. Agents never
wait for GitHub ([kixelated/quest#276](https://github.com/kixelated/quest/pull/276)).

- Today [landing](/cloudflare/src/jobs/landing.ts) releases the merge hold when a
  landing ends unmerged, which leaves the PR an idle decision. Start the new
  job from that same event.
- The maintainer's merge pick authorizes the new job, as the merge skill's
  ejection rule says. Any other ejection reason, or a person dequeuing it,
  stays the maintainer's call.
- The job lands only a head with a review that counts, per
  [land review](/quest/m0/kix/land-review.md). The design checkpoint every
  fourth review round bounds repeated ejections.
- Decide in the PR which label marks a PR left for the maintainer.

## Related

- [Land review](/quest/m0/kix/land-review.md) - kix lands only reviewed heads
