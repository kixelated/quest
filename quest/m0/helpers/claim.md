# [S] Claim and release quests with quest claim

## Goal

`quest claim <quest>` claims a ready quest the way `quest guide` describes,
and `quest unblocked --unclaimed` lists ready quests nobody holds. Agents stop
running `git ls-remote origin 'refs/heads/quest/...'` and
`gh pr list --head/--search` by hand before starting or spawning (105 of 396
sessions), since `quest ready` checks no claims.

## Plan

- Decided 2026-10-19 (user): one `claim` command plus an `--unclaimed`
  filter, rather than a separate claims listing.
- `claim` refuses a blocked quest, checks for an open PR from the quest's
  branch, then pushes an empty commit with the explicit refspec
  `refs/heads/<branch>:refs/heads/<branch>`, never forcing. A rejected push
  means someone else holds the claim, which makes the push the atomic check.
  Distinct exit codes separate "taken" from a failure.
- Decided (user): `quest claim --release <quest>` deletes the remote claim
  branch only while its tip is still the empty claim commit and it has no
  open PR, using a lease on that SHA; otherwise it refuses and says why.
- `quest unblocked --unclaimed` uses one `ls-remote` for `refs/heads/quest/*`
  and one query for open PRs, and prints skipped claims on stderr with their
  age and PR so stale claims can be offered for takeover.
- The branch check is plain git. Only the open-PR check is GitHub-specific;
  with a non-GitHub origin it is skipped with a warning. kix.quest publishes
  quest branches and PRs, so its jobs count as claims here too.
- Default the remote to origin, with `--remote` to override.
- Update `start` and `spawn` skill prose to use these commands.
- Test claiming free and taken quests, a race between two claimers, an open
  PR without a branch claim, releasing a claim, refusing to release a branch
  with work on it, and the filtered ranking.
