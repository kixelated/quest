# [S] Settle ungated landing freshness

## Goal

Decide whether an immediate comparison against the live base is sufficient for
ungated landings, or whether landing must atomically require the current base
through server-side protection or a queue.

## Plan

Narrowed 2026-10-27 (user): apply the freshness refusal only to ungated bases.
A base gated by `quest land` uses its existing current-base merge/test chain;
queuing a PR must not add a per-PR base merge and check cycle.

Implemented in [kixelated/quest#253](https://github.com/kixelated/quest/pull/253):
the ungated command compares the live base ref against the pinned head and
refuses a behind or diverged head, naming both commits. The shared design
checkpoint and the required-review timeout instruction are implemented too.

Remaining decision: GitHub's merge API pins `expectedHeadOid` but has no expected
base OID. The base can move between the comparison and the mutation, so this
preflight cannot promise atomic freshness at landing time.

- Recommended: accept the immediate live-base preflight for ungated bases,
  documenting that race; `quest land` remains the stronger current-base gate.
- Or require server-side protection or a queue for an atomic guarantee. Choose
  that requirement and its scope before implementing another landing mechanism.

The original 2026-10-24 plan rejected requiring GitHub's up-to-date protection;
this API limit needs a new explicit decision rather than silently adding it.

## Related

- [Wait and status accuracy](/quest/m0/helpers/wait-accuracy.md) - reports the review-round count the shared checkpoint reads
