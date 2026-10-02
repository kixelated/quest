# [M] Add claim sections to the quest format

## Goal

A quest can carry a `## Claim` section naming who holds it, so a contributor
without push access can lock a quest with an ordinary commit. `quest check`
validates the section, `quest ready` treats a claimed quest as not ready, and
`quest guide` documents it. GitHub skills keep using branch claims, and GitHub
issues are unchanged.

## Plan

- The claim lives inside the quest file, not in a sidecar. If a maintainer
  edits a quest after it was claimed, the merge conflict is wanted: the plan
  changed under someone working on it.
- Content: one list item naming the claimant, the identity provider, the
  fork or branch where the work happens, and the date, e.g.
  `- Jane Doe (github:jdoe) on <fork url> since 2026-10-02`. Keep the check
  loose enough that forges can add fields.
- `quest ready` with no path leaves claimed quests out. `quest ready <path>`
  prints the claim as the blocker, with the claimant on stderr.
- The CLI stays clock-free. Expiry belongs to the forge, which deletes stale
  claims (on Cloudflare, after 48h without a push to the claimant's fork).
- Update `assets/AGENTS.md` (the guide) and the README's format example. In
  `quest-start`, a quest with a claim section counts as taken.

## Related

- [Fork intake](/quest/m0/cloudflare/intake.md) - writes and expires claims on Cloudflare
