# [S] A fork with its own quests is its own upstream

## Goal

In a GitHub fork that keeps its own quest tree, such as kixelated/rind (a
fork of ctz/graviola), `quest unblocked --unclaimed` and `quest start` read
and claim quests on the fork itself, and never fetch from, push to, or open
a PR on its parent. A contributor's fork of such a repository still claims on
that repository, as a fork of moq-dev/moq does today.

## Plan

Decided 2026-10-27 (user) after `quest start` in kixelated/rind would have
opened its claim PRs on ctz/graviola, and `quest unblocked --unclaimed` read
graviola's tree, which has no quests. Until this lands, rind's agents claim by
hand on kixelated/rind.

- How should quest decide that a fork is its own upstream?
  - ✅ Walk up the fork chain while the parent's default branch holds
    `quest/README.md`; the upstream is the last repository reached
  - Checked-in declaration naming the upstream
  - Per-clone git config

  It needs no config. rind resolves to itself, a fork of rind to
  kixelated/rind, and a fork of moq to moq-dev/moq. The rule
  "nearest repository with quests, starting at the remote" was rejected, since
  a contributor's fork carries `quest/` too and would claim on itself.

`upstream()` in `src/cli/claims.ts` resolves every caller (`start`, the
`--unclaimed` ranking, and the others that call it), so the walk lives there:
one contents lookup per fork level, through the same GitHub client. Update
the `unblocked` and `start` help text in `src/cli/main.ts` and the guide's
fork sentences. Test both chains (a fork whose parent has no quests, and a
fork of a fork with quests) against the GitHub fake.

## Related

- [Agent workflow helpers](/quest/m0/helpers/README.md) - the claim commands this changes
