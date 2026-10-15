# GitHub App integration

The operator registers one public Quest App from the reviewed
[manifest](github-app-manifest.json). Project users install that existing App;
they do not create their own bots. OAuth login remains separate. The App's
installation identity authors service comments and pull requests. App secrets
and installation tokens stay inside the Worker; agents receive neither.

## Permissions and events

| Repository permission | Why the installation grants it                                              | Per-operation token                                        |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Metadata: read        | Resolve repository identity and maintainer authority                        | Every operation                                            |
| Contents: write       | Read quest files, publish approved quests to service forks, explicit merges | Read for quest reads; write only for publishing or merging |
| Issues: write         | Read native issues and publish approved comments                            | Read or write for that operation                           |
| Pull requests: write  | Observe, create approved draft PRs, explicitly merge an exact head          | Read or write for that operation                           |
| Checks: read          | Observe checks on a commit                                                  | Check reads only                                           |
| Commit statuses: read | Observe legacy CI status contexts                                           | Check reads only                                           |

The manifest subscribes to push, issues, issue comments, pull requests, reviews,
checks and statuses. GitHub also sends installation lifecycle and repository
selection events automatically. No organization, administration, workflow,
checks-write, or user permissions are requested. These installation grants
are necessarily broader than individual operations: minted tokens always name
one repository ID and the particular permissions required. Tokens are never
cached and are revoked after use; failed cleanup is logged without secrets and
does not retry a successful write. GitHub also expires tokens after an hour.

## Trusted boundary

`src/github/service.ts` provides specific server-only operations for quest
reads, issue/PR reads, check/status reads, comments, approved quest publication,
draft PR creation, and an explicitly authorized merge with an expected head SHA.
Callers pass a user ID obtained from an authenticated local session. The service
resolves its linked OAuth account, looks up the current GitHub login by numeric
ID, and verifies current repository admin or maintain authority. A browser's
login name, claimed installation, repository role, or webhook sender grants no
authority. Ordinary write and custom roles are rejected. Installation identity,
permission grants and repository identity are fetched live for every operation.

These methods are integration primitives, not public HTTP routes or an agent
tool interface. Their trusted caller owns the user's approval of the exact
output/action, product policy, branch protections and review/check gating.
Webhook receipt never supplies that approval. No automatic comments, PRs,
merges or runner launches occur. Check reads accept a page number (default 1) and return up to 100 checks
and status contexts with GitHub's totals; callers must request additional pages
before treating the result as complete or approving a merge.

The App does not own repositories. Configure `GITHUB_FORK_OWNER` as a separate
service-controlled namespace and install the App on each provisioned fork.
The operator provisions forks using GitHub's fork flow, subject to organization
policy and private-fork restrictions. An installation token cannot impersonate
a user to own a fork; access to upstream does not grant access to its fork.
Destination permissions/installations must be supplied independently. No fork
creation or organization provisioning permission is requested by this service.
Publication is restricted to `quest/*.md` on an existing `quest/...` branch in
that namespace. The service verifies the fork's immediate parent ID is the
upstream ID. PR creation uses an upstream-scoped token and an explicit head
owner and repository; for organization cross-repository PRs GitHub requires
`head_repo`. Installation tokens cannot span two owners, so the fork-scoped
token only pushes and the upstream token cannot grant maintainer edits on the
fork branch; PRs are created with `maintainer_can_modify: false`.
Agents cannot choose another namespace or obtain Git credentials.

## Webhooks and revocation

`POST /webhooks/github` verifies `X-Hub-Signature-256` over the exact raw bytes
before parsing. GitHub's 25 MB payload ceiling bounds the request. Delivery IDs,
body digest, event and minimal installation/repository metadata persist in D1;
untrusted issue/PR bodies are not stored. Dedup and lifecycle changes commit in
one transaction. A duplicate cannot reapply a state transition; reuse with a
different body/event is rejected for 30 days; each insert prunes older records
in the same transaction. There is no asynchronous enqueue/ack gap or remote side
effect here.

Deleted or suspended installations immediately gate new local operations.
Permission and repository-selection changes invalidate the recorded revision;
operations never rely on a cached revision for authority. Created/unsuspended
installations can reopen the local gate, but every operation still queries
GitHub live, so delayed events cannot restore access GitHub revoked. A failed
GitHub lookup, removed repository, reduced permission, suspended installation,
or changed repository ID fails closed. Already in-flight remote writes may
finish; no new work is authorized from event observations. Consumers should
reconcile current provider state rather than replay issue/PR payloads as facts.

## Operator setup

1. Review the manifest's name, homepage, webhook URL, permissions and events.
   Register the public App once under the service owner's account using
   [GitHub's manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
   or enter the same settings in GitHub. For the manifest flow, submit the JSON
   as the `manifest` form field to GitHub's new-App endpoint with a random
   CSRF state and your operator-controlled redirect URL. Verify returned state
   and exchange the temporary code at `POST /app-manifests/{code}/conversions`
   within one hour. This repository intentionally has no public registration
   callback that would disclose the generated credentials.
2. Store the returned/generated App ID in the `GITHUB_APP_ID` Wrangler var.
   Put the PEM private key and high-entropy webhook secret into Workers secrets
   named `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` using
   `bun run wrangler secret put NAME` from `cloudflare/`. Keep multiline PEM
   intact. Keep the existing `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` for OAuth
   login; they are separate credentials. Never commit conversion responses,
   PEM keys, installation tokens or `.dev.vars`.
3. Set `GITHUB_FORK_OWNER` to the service-controlled namespace. Provision its
   forks/branches and install the public App there and on selected upstream
   repositories. Existing installations must accept permission increases before
   operations needing those grants become available. GitHub's installation
   UI, not browser form claims, chooses repository access.
4. Run `bun run wrangler d1 migrations apply DB --remote`, then the normal
   Worker deployment from [README](README.md). GitHub App setup, credentials,
   production deployment, fork namespace ownership and live installation tests
   are operator work; this change performs none of those external actions.
5. Send a GitHub ping, check successful delivery, then test installation
   suspension/removal and repository deselection in a development installation.
   Check that service operations reject revoked access and reduced permissions.
   Use GitHub's delivery/redelivery UI to retry failed deliveries. Rotate the
   private key and webhook secret through Workers secrets and the App settings.

For local tests, fixtures sign bodies and mock all GitHub API responses. No
production credentials, GitHub account or installation are required.

References: [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[repository permissions](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user),
[forks](https://docs.github.com/en/rest/repos/forks#create-a-fork),
and [PR creation](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request).

The earlier draft #43 informed JWT/signature handling and current repository
identity checks. Its Rust/WASM, mirroring, Artifacts credentials, custom changes,
workflow orchestration and repository coordinator design were not reused.

## Project enrollment (draft)

`/projects` is the short maintainer setup flow, separate from the quest board
and decision inbox. It resolves the registered App's installation URL, accepts
an explicit `owner/repository` selection, and verifies the linked GitHub
identity's current maintain/admin authority through the existing service.
Installing the App never creates a `github_projects` record or enables work.

The preview reads the default branch at an exact commit, validates its Quest
tree with the shared core, and lists ready quests. It rejects private,
unavailable, incomplete, invalid, and symlinked quest snapshots. Repositories
without Quest files follow `/setup`; no repository writes occur during setup.

The D1 enrollment records a project-wide enabled/paused state, distinct from
installation permissions. Every opt-in/resume, pause, and disconnect rechecks
current authority and provider gates. Pause/disconnect do not require valid
Quest files or public visibility, so maintainers can stop contributions after
those conditions change. Disconnect deletes the enrollment, not the GitHub
App installation or existing contributions. Remembered selections are only
navigation and never confer authority. Future job coordination must recheck
this state and current provider eligibility before launching new work.

**Unresolved product decision:** how to verify that a public repository is
open-source. No production policy is selected here. `OpenSourcePolicy` is a
server-only check supplied to `GitHubService`; until the policy is settled and
wired into production, opt-in/resume fail closed and their UI controls stay
disabled. Tests inject a fixture-only policy to verify the independent state
transitions. GitHub's detected license is available to the eventual policy;
public visibility alone never enables contributions.

Recommendation for review: require a GitHub-detected SPDX ID matching an
OSI-approved license, and show setup guidance for undetected licenses. A known
SPDX ID alone does not establish OSI approval. The official
[OSI license API](https://opensource.org/blog/introducing-the-new-api-for-osi-approved-licenses)
provides approval status and SPDX identifiers. Confirm this rule or choose a maintainer attestation/manual review
path before completing the quest. GitHub detects licenses with a limited
known-license matcher, so this recommendation can exclude valid custom or
unrecognized licensing arrangements. See the official
[license API documentation](https://docs.github.com/en/rest/licenses/licenses),
[Git trees API](https://docs.github.com/en/rest/git/trees#get-a-tree), and
[App metadata API](https://docs.github.com/en/rest/apps/apps#get-the-authenticated-app).

The project-state quest owns ongoing snapshots, branches, PRs, and event
reconciliation; this setup preview does not reserve or launch ready quests.
The jobs/funding quests own live eligibility checks and contribution execution.
