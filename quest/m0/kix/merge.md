# [S] Merge PRs from the decision inbox

## Goal

A PR item in the decision inbox offers a merge button when the maintainer may
merge it. Clicking it merges exactly the head they reviewed through GitHub,
using a method the repository allows, or shows GitHub's refusal plainly.

## Plan

Decided 2026-10-18 as a follow-up of the decision inbox (#144), whose PR items
offer only "Review on GitHub":

- Build on `mergePullRequest` in `cloudflare/src/github/service.ts`: bound
  to the current head, with the method picked from the repository's allowed
  methods (squash, then merge commit, then rebase). Keep that logic there and
  only add the inbox action here.
- Show the button only when it can work: the PR is open, the viewer passes
  the per-request maintainer check, and GitHub reports it mergeable. Otherwise
  keep "Review on GitHub".
- Bind the form to the head SHA the maintainer saw. A moved head, failing
  checks, missing reviews, or branch rules refuse the merge and say why; never
  retry or bypass them.
- A PR that is not clean starts a [merge job](/quest/m0/kix/merge-job.md)
  instead, whose pick covers its own fixes. Decided 2026-10-20 (user).
- An agent recommendation is never approval: the merge happens only on the
  maintainer's click.
- Test a moved head, a refused merge, a squash-only repository, and a
  non-maintainer.
