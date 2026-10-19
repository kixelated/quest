# [S] Show co-maintainers' projects in their inbox

## Goal

Every current maintainer of an enrolled project sees it in their decision
inbox, not only the user who enrolled it. A maintainer whose access is revoked
stops seeing it.

## Plan

Decided 2026-10-18 as a follow-up of the decision inbox (#144), which lists
only projects the viewer enrolled (`enrolledBy`):

- A maintainer joins a project's inbox membership when they pass the
  per-request maintainer check on its project page. No extra GitHub calls to
  list maintainers.
- Membership only decides which projects the inbox lists. It is not
  authority: every action still rechecks the maintainer per request.
- Any failed maintainer check drops that user's membership along with their
  read and skip state for the project. The enrolling user is a member like
  any other.
- Disconnecting a project removes its memberships with it.
- Test a co-maintainer joining, a revoked maintainer dropping out, and a
  non-maintainer never joining.

## Required

- [Decision inbox](/quest/m0/kix/prompts.md) - the inbox and its read state
