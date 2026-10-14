# [M] Publish agent work through the GitHub bot

## Goal

Authorized planning and implementation results become ordinary GitHub PRs
under the App bot's identity, with contributor/model attribution appropriate
to the repository. Repeated delivery updates the same intended PR. Agents
and donor machines never receive the App's credentials.

## Plan

- Keep publication in a trusted service component. Validate the active job,
  permitted workflow output, pinned source, and expected branch/head before
  writing anything. Treat submitted patches and files as data; do not run
  their scripts or hooks in the publisher.
- Use service-controlled fork branches for contributed output, distinct from
  the bot identity. Confirm GitHub's cross-installation fork/PR behavior with
  an integration test. Keep Actions and secrets off those service forks.
- Plan jobs may publish the authorized quest changes and their interview
  paper trail, not unrelated source changes. Implementation/iteration may
  publish their selected task's changes. Unsupported permission-sensitive
  changes must produce a decision, not be silently dropped.
- The service may need broader App registration permissions than each
  operation uses; document that truthfully and narrow issued tokens.
  No job gets an unrestricted push credential or permission to write main.
- For iteration on a human-authored PR, verify authority to update its actual
  head, including contributor-fork permissions. If unavailable, report the
  blocked action; do not silently open a replacement PR.
- Open planning PRs as drafts for maintainer review. Implementation PRs are
  drafts while decisions or unfinished work remain; otherwise follow the
  normal repository workflow. Preserve partial output after a stopped run.
- PR status, checks, and reviews remain GitHub's. A maintainer may explicitly
  authorize a GitHub merge bound to the current head; honor branch rules and
  refusals, and never interpret an agent recommendation as approval.
- Fork PRs do not make unsafe privileged CI safe. Document that upstream
  workflows must treat contributed code as untrusted; do not grant donor
  code upstream credentials or run it in the publisher.
- Reconcile ambiguous GitHub outcomes before replaying publication so
  interruptions cannot create duplicate PRs or overwrite newer work.
- Sources:
  [fork API](https://docs.github.com/en/rest/repos/forks#create-a-fork),
  [PR API](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request),
  and [installation token scopes](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

## Required

- [GitHub App](/quest/m0/kix/github.md) - bot credentials and scoped GitHub operations
- [Job coordination](/quest/m0/kix/jobs.md) - current action and publication authorization
