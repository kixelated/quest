# [L] Batched merge gate: quest land

## Goal

`quest land`, run from a repository's own CI, lands every PR whose landing
was requested as one tested batch. It builds the queued PRs, in enqueue
order, into a chain of squash commits on the base branch, resolving quest
files with `quest resolve`. It runs the repository's check command once on
the chain's tip and fast-forwards the base to the longest passing prefix.
Each landed PR shows as merged. The base only ever holds a tree the gate
tested, and a PR that fails alone or conflicts outside quest files is ejected
with a reason `quest status` reports. It works on any GitHub repository,
including user-owned ones that cannot use GitHub's merge queue.

## Plan

Decided 2026-10-26 (user), planning moq-dev/moq's merge throughput
([moq-dev/moq#6854](https://github.com/moq-dev/moq/pull/6854)). Over 414
queue merges, the serial GitHub merge queue landed 5.5 PRs per hour.
Waiting behind other entries was 98% of the time, with a median of 18 PRs
ahead of each new entry. GitHub's merge queue cannot test several PRs in one
run ("merge limits do not combine `merge_group` builds"), and Mergify merges
through the API, so neither can guarantee the tested tree or run the merge
driver.

- **Host.** A CLI subcommand in `src/cli/`, run by a thin workflow in each
  repository. It needs no kix. moq.pro's `gate.yml` and `queue.yml` are the
  serial precedent. kix's merge jobs feed the same queue through their
  `deliver` landing.
- **Trust split.** Three phases, so PR code never sees a push credential:
  a trusted hosted job resolves the queue and the chain's inputs, an
  untrusted job builds the chain and runs the repository's check command
  with a read-only token, and a trusted hosted job lands. The push token is
  the repository's choice: moq uses its moq-bot App with the key in a
  main-only Environment; moq.pro, kixelated/quest, and kixelated/rust2 put
  GitHub Actions in the bypass list, behind a source-policy test.
- **Landing.** Write each PR's squash commit onto the chain. Force-push each
  PR's branch, with a lease on the head that was tested, to its commit. Then
  fast-forward the base to the tip in one push. GitHub marks a PR merged
  once its head is on the base, so history stays linear and each PR shows as
  merged. Verify that GitHub behavior against a scratch repository first. If
  it does not hold, stop and report rather than fall back to closing PRs.
  A failed lease stops the landing. The prefix before it lands only if a
  check passed on exactly that prefix, since a later PR can mask an earlier
  one's failure; otherwise nothing lands. The gate's own head pushes must not
  dequeue the PR they move.
- **Batches.** Every queued PR, with no size constant. On failure, test the
  first half; a passing prefix lands at once and the rest continues. A PR
  that fails alone is ejected with a comment linking the run. No retries.
  Order is enqueue order, with no priority classes.
- **Queue membership.** This quest decides, with a recommendation to the
  user, how a repository without GitHub's merge queue marks a PR queued and
  pins the head that was approved. `quest merge --land <sha>` already holds
  the PR with `quest:merge` and enables auto-merge bound to that head. In a
  gated repository the base requires a check that PR heads never carry, so
  that auto-merge only waits. A push by anyone but the gate dequeues the PR.
- **Ejection.** Remove `quest:merge`, comment with the reason, and make it
  readable through `quest status`'s `landing-stopped`, alongside GitHub's
  queue reasons (`merge_conflict`, `failed_checks`).
- **Forks.** A fork PR without maintainer edits cannot have its head moved,
  so it is ejected with a comment asking for them.
- Update `--help`, the README, and the merge skill's landing prose. The user
  asked for those skill edits through this plan.
- Test chain building, prefix bisection, ejection, a failed lease (including
  A failing alone and A+B passing when B's lease fails, which lands nothing),
  and a quest-file conflict resolved by the driver, against the shared fake
  GitHub (`cloudflare/dev/github.ts`) and a local git repository.

Adopters, each through its own plan: [kixelated/quest](/quest/m0/helpers/land-adopt.md),
[moq-dev/moq](https://github.com/moq-dev/moq/blob/main/quest/m0/ci/land.md),
moq-dev/moq.pro, and kixelated/rust2.

## Related

- [Sibling PRs through a server-side merge](/quest/m0/helpers/queue-siblings.md) - the same conflicts for repositories that still merge on GitHub
- [Land only heads tested against the current base](/quest/m0/helpers/landing.md) - the single-PR landing rule this generalizes
