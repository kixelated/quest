# [L] Connect the service through a GitHub App bot

## Goal

The service has a GitHub App integration that identifies installations and
maintainers, receives authenticated webhook events, and offers scoped
GitHub operations to the rest of the application. An operator can register
the actual bot using a reviewed manifest and setup instructions.

## Plan

- User explicitly requested the bot on 2026-10-13. Use an App installation
  identity for service-authored PRs and comments; project users install the
  existing public App rather than registering their own.
- Keep provider-specific code outside the quest core. Reuse the existing
  GitHub login where appropriate, but verify maintainer authority against
  the current repository/installation instead of trusting browser claims.
- Define the permissions and events from the supported operations: reading
  quests and native issues, observing PRs/checks, publishing approved output,
  and carrying out explicitly authorized GitHub actions. Document the full
  installation permissions, including GitHub's cross-fork constraints.
- The App's bot identity does not own repositories. Support a separately
  configured, service-controlled fork namespace for contribution branches.
  Mint tokens with the narrowest repository/permission scope needed by an
  operation; never distribute App secrets or installation tokens to agents.
- Verify webhook signatures, deduplicate deliveries, and handle installation
  removal or permission changes. Revocation stops new authorized work.
- Review the useful App/webhook pieces of draft #43, but do not restore
  mirroring or its obsolete stack. Tests use signed fixtures and mocked
  GitHub responses; operator setup owns real registration and credentials.
- Official references:
  [App manifests](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
  [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
  and [fork creation](https://docs.github.com/en/rest/repos/forks#create-a-fork).
