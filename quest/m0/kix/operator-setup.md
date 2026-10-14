# [S] Register and configure the Kix GitHub bot

## Goal

The operator registers the reviewed GitHub App, configures its secrets in
the deployed service, supplies a service-controlled fork namespace, and
installs it on the pilot repositories. A real issue event and a bounded
test PR verify the integration before contributors are invited.

## Plan

- This is an operator/setup outcome. No App was created during the
  2026-10-13 planning interview.
- The operator chooses the registration owner, available App name, and fork
  namespace during setup. The bot identity is distinct from that namespace;
  do not assume an App can own a fork by itself.
- Review the actual requested permissions before registration. Configure
  App ID, private key, webhook secret, and any login credentials as service
  secrets, never in git or an agent worktree.
- Use the canonical kix.quest URLs and validate real installation-token
  behavior across upstream and service-owned forks.
- Configure the operator's hosting limit and explicit API funding for the
  rehearsal. A live test must not draw on an unidentified donor account.
- Record nonsecret setup/run instructions and deployment identifiers.
  Remove the quest when the setup condition is fulfilled.

## Required

- [Primary domain](/quest/m0/kix/domain.md) - stable callback and webhook URLs
- [Bot publication](/quest/m0/kix/publication.md) - the integration exercised by the test PR
