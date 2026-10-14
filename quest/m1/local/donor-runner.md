# [L] Contribute local API-funded execution capacity

## Goal

A contributor registers a local runner for selected projects and capacity.
It claims authorized implementation jobs over HTTPS, executes through the
shared Agent SDK worker, and returns results for trusted bot publication.

## Plan

- Reuse durable claims, fencing, cancellation, and progress transport.
  Keep the public CLI and daemon lifecycle separate without duplicating execution.
- Explicitly select projects, API payer, and capacity. Honor project pauses and
  donor revocation, and preserve interrupted results without duplicate jobs.
- Keep provider and GitHub credentials outside repository-controlled code.
  Never give local workers service-wide App credentials or trust their claims
  about successful checks as authority to merge.
- Support trusted projects first with an explicit local trust boundary.
  Stronger untrusted-project isolation is a separate quest.
- This API-funded daemon does not turn a local Claude subscription into an
  unattended hosted API pool. The local plugin uses its normal session.
- Test registration, stale leases, reconnect, cancellation, and publication
  rejection for mismatched repository/revision.

## Required

- [API worker CLI](/quest/m1/local/api-worker.md) - reusable local execution
