# GitHub App integration

The operator registers one public Quest App from the reviewed
[manifest](github-app-manifest.json). Project users install that existing App;
they do not create their own bots. OAuth login remains separate. The App's
installation identity authors service comments and pull requests. App secrets
and installation tokens stay inside the Worker; agents receive neither.

## Permissions and events

| Repository permission | Why the installation grants it                                              | Per-operation token                                            |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Metadata: read        | Resolve repository identity and maintainer authority                        | Every operation                                                |
| Contents: write       | Read quest files, write job branches on service forks and iterated PR heads | Read for quest reads; write only for that publication or merge |
| Issues: write         | Read native issues and publish approved comments                            | Read or write for that operation                               |
| Pull requests: write  | Observe, open and update job PRs, explicitly merge an exact head            | Read or write for that operation                               |
| Checks: read          | Observe checks on a commit                                                  | Check reads only                                               |
| Commit statuses: read | Observe legacy CI status contexts                                           | Check reads only                                               |

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
reads, issue/PR reads, check/status reads, comments, job publication (see
[Publication](#publication)), and an explicitly authorized merge with an
expected head SHA.
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
merges or runner launches occur; a job publishes only what its maintainer
authorized, on behalf of that maintainer's current authority. Check reads accept a page number (default 1) and return up to 100 checks
and status contexts with GitHub's totals; callers must request additional pages
before treating the result as complete or approving a merge.

The App does not own repositories. Configure `GITHUB_FORK_OWNER` as a separate
service-controlled namespace and install the App on it. The operator provisions
each upstream's fork there under the upstream's repository name, using GitHub's
fork flow, subject to organization policy and private-fork restrictions. An
installation token cannot impersonate a user to own a fork; access to upstream
does not grant access to its fork. No fork creation or organization
provisioning permission is requested by this service.

## Publication

A running job publishes its work at `POST /api/runner/publish`, authenticated
with its runner's bearer token (`src/jobs/publish.ts`). The JSON request names
the `job` and `attempt`, the commit the changes build on (`head`, or `null`
before the job's branch exists), a commit `message`, and `changes`: up to 500
files, 16 MiB in all, each `{ path, content, executable?, symlink? }` with
base64 content, or `null` content to delete. A symlink's content is its target.
Submodule changes cannot be published. An optional `pull: { title, body, draft }`
opens or updates the job's pull request, and `session` names the agent session
to resume if the publication needs a decision. Checkpoints publish work in
progress the same way, so a reassigned job continues from its branch. The reply
is `{ head, pull? }`, or `202 { decision, cancel }` when the job paused.

Submitted files are data. The publisher never checks them out or runs their
scripts or hooks: it writes blobs, a tree, and a commit with the Git Data API
and moves one branch. Before writing anything it checks, in order:

- The request comes from the job's current `(attempt, runner)` while it runs.
  A cancelling attempt may still publish its partial work. A reassignment
  increments the attempt, which fences out the previous runner.
- Every path is a plain work-tree path: no `.git`, `.` or `..` segment, no
  absolute path, backslash, or control character. Each workflow publishes
  only its own changes: `plan` only quest documents under `quest/` (Markdown
  other than `AGENTS.md` and `CLAUDE.md`), `bootstrap` only `flake.nix` and
  `flake.lock`, `start` and `iterate` their task's changes. No workflow changes
  `.github/workflows/`, because the App does not request the workflows
  permission. A refused change pauses the job with a `publication` decision
  listing each path and reason, instead of being dropped; the maintainer's
  answer resumes the agent's session.
- The job's requester still holds maintainer authority, and the repository's
  identity, visibility, installation, and enrollment are checked live, as for
  every other operation.
- The branch is where the job left it: absent before the first publication,
  then the last commit kix published. A `head` that differs gets a reply naming
  the commit to continue from. A branch changed outside the job, or one that
  earlier work left on the fork, becomes a decision; it is never overwritten.

`plan`, `start`, and `bootstrap` jobs write their branch on the service fork
`GITHUB_FORK_OWNER/<repository>`, whose immediate parent must be the upstream's
repository ID. An `iterate` job writes its pull request's actual head: an
upstream branch through an upstream-scoped token, or a service fork branch.
GitHub gives an installation no write access to a contributor's fork, so that
case pauses with a decision reporting the blocked update; kix never opens a
replacement pull request. No job writes a repository's default branch, and no
runner ever receives a credential.

The App authors the commits as well as the pull requests: the service sets no
author or committer, so GitHub attributes and signs them as the App.
Contributor and model attribution comes from the agent's commit message and
pull request body, written to the repository's own instructions.

Interruptions are reconciled before anything is replayed. The service creates
the commit, records it as pending under the attempt fence, and then moves the
branch with a fast-forward-only update. If the outcome is lost, the next
publication finds the pending commit on the branch and adopts it; until then,
for up to two minutes, other publications of the job wait. GitHub cannot check
kix's fence, so the fence is rechecked immediately before that update: a
fenced-out attempt's write lands only if it passed the check before the
reassignment, and the fast-forward check means it can never overwrite newer
work. Delivery looks for the branch's open pull request before creating one,
and reconciles a refused creation the same way, so a retry never opens a
duplicate. A pull request the maintainer closed is not replaced.

Planning pull requests are always drafts, as are those of jobs asked to stop.
Other jobs set `draft`, which defaults to `true` while decisions or unfinished
work remain; a later delivery with `draft: false` marks the pull request ready.
kix never converts a ready pull request back. Delivery requires an enabled
project; a paused project's running jobs can still preserve their work on their
branches. Pull requests use `maintainer_can_modify: false`, because an
upstream-scoped token cannot grant edits on the fork branch.

GitHub keeps pull request status, checks, and reviews. `mergePullRequest`
merges only an exact head a maintainer explicitly chose, with the first method
the repository allows: squash, then a merge commit, then rebase. GitHub's
branch rules and refusals stand, and an agent's recommendation is never
approval. The decision inbox offers it on a pull request item only when
GitHub reports the PR's merge state as `CLEAN` or `HAS_HOOKS` and no job holds
the PR. The form binds the head on screen. A moved head asks for another look,
GitHub's refusal is shown in its own words, and neither is retried.

Fork pull requests do not make privileged CI safe. Workflows that run a pull
request's code with secrets or write tokens, such as `pull_request_target` or
`workflow_run` jobs that check out its head, run contributed code with upstream
credentials. Upstream workflows must treat kix pull requests as untrusted
contributions like any other fork's. kix grants contributed code no upstream
credentials and never runs it in the publisher. Keep Actions disabled and
secrets absent on service forks, since the bot pushes contributed code there.

Installation grants are broader than any one publication: `contents: write`
and `pull_requests: write` cover every installed repository. Each token names
one repository ID and only the permissions that step needs. Fork writes get
`contents: write` on the fork alone, pull request delivery gets
`pull_requests: write` on the upstream alone, and only an iteration on an
upstream head gets upstream `contents: write`. That token could write any
unprotected upstream branch; the service restricts it to the pull request's
head and refuses the default branch, and repositories should still protect
their default branch.

Mocked tests cover this path. These GitHub behaviors still need a live check
against real installations ([operator setup](../quest/m0/kix/operator-setup.md)):
creating a fork-headed pull request with an upstream installation token while
the fork belongs to another installation; creating a fork commit whose parent
is an upstream commit pushed after the fork was made; GitHub's signature on
App-authored API commits; and pushing an upstream pull request head with an
installation token under the repository's branch rules.

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
3. Set `GITHUB_FORK_OWNER` to the service-controlled namespace. Fork each
   pilot upstream into it under the same repository name, disable Actions on
   those forks and keep secrets off them, and install the public App there and
   on selected upstream repositories. Existing installations must accept permission increases before
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

## Project enrollment

`/projects` is the short maintainer setup flow, separate from the quest board
and decision inbox. It resolves the registered App's installation URL, accepts
an explicit `owner/repository` selection, and verifies the linked GitHub
identity's current maintain/admin authority through the existing service.
Installing the App never creates a `github_projects` record or enables work.
Repository selection resolves its installation using the App JWT, then reads
metadata with a token restricted to the named repository and metadata-read
permission. Subsequent authorized operations scope tokens by repository ID.
Resolution uses the same installation gates and token revocation as other
reads; it never consumes GitHub's shared anonymous repository-lookup quota.

The preview reads the default branch at an exact commit, validates its Quest
tree with the shared core, and lists ready quests. Blob selection uses the
core's `isQuest` predicate, excluding root and nested `AGENTS.md`/`CLAUDE.md`
instructions just as the CLI does. It fetches all quest blobs
in one GraphQL read using the scoped installation token, rather than one
external request per file. Blob IDs come from the pinned Git tree; missing,
binary, truncated, partial, or hash-mismatched content fails closed. This keeps
enrollment's external request count independent of the number of quest files.
It rejects private,
unavailable, incomplete, invalid, and symlinked quest snapshots. Repositories
without Quest files follow `/setup`; no repository writes occur during setup.

The D1 enrollment records a project-wide enabled/paused state, distinct from
installation permissions. Every opt-in/resume, pause, and disconnect rechecks
current authority and provider gates. Pause/disconnect do not require valid
Quest files, public visibility, or an active/unarchived repository, so maintainers can stop contributions after
those conditions change. Disconnect deletes the enrollment, not the GitHub
App installation or existing contributions. Remembered selections are only
navigation and never confer authority. Any current maintainer can select an
already enrolled repository by name and reach pause/disconnect even if it has
become private, archived, or Quest-invalid. The enrolled-project lookup proves
current identity and authority independently of the failing preview; it does
not depend on being the original enroller. It matches enrollment by the durable
GitHub repository ID, and refreshes the stored owner/name after authority is
verified, so selecting a renamed repository recovers the same stop controls. If a transfer
or reinstall changes the App installation, those stop controls remain available
while the new installation requires explicit opt-in; selection never silently
reassigns an existing contribution authorization to the new installation. Future job coordination must recheck
this state and current provider eligibility before launching new work.

Contributions require a public repository whose GitHub-detected SPDX license
identifier matches a license marked `isOsiApproved: true` in SPDX's current
published license metadata. A recognized SPDX identifier alone is insufficient.
Missing, `NOASSERTION`, custom, and non-OSI licenses cannot opt in. Add or correct
the repository's license on GitHub and return to setup; no manual attestation
or review bypass is provided. This policy was selected by the maintainer on
2026-10-15 to make public open-source eligibility explicit and independently
verifiable.

Each preview, opt-in, and resume reads
`https://spdx.org/licenses/<detected SPDX ID>.json` without storing a positive
authorization cache. The returned ID must match exactly, and the approval flag
must be the boolean `true`. Failed/malformed lookups fail closed with guidance;
pause and disconnect remain available. Opt-in/resume recheck live repository
identity, visibility, detected license, OSI approval, and maintainer authority
after reading the quest snapshot. Neither license names nor browser form fields
can override those checks. Deprecated SPDX identifiers GitHub still detects
remain supported when SPDX marks that exact ID OSI-approved.

This uses the maintained [SPDX JSON interface](https://github.com/spdx/license-list-data/blob/main/accessingLicenses.md)
instead of maintaining an application allowlist. Approval freshness follows
SPDX's latest published license list and the upstream serving infrastructure.
GitHub's detector only recognizes a limited set of license files, so custom or
unrecognized arrangements stay ineligible even when they may be open-source.
See the official [GitHub license API](https://docs.github.com/en/rest/licenses/licenses),
[SPDX license list](https://spdx.org/licenses/),
[Git trees API](https://docs.github.com/en/rest/git/trees#get-a-tree),
[GraphQL blobs](https://docs.github.com/en/graphql/reference/git#blob), and
[App metadata API](https://docs.github.com/en/rest/apps/apps#get-the-authenticated-app).

The setup preview does not reserve or launch ready quests.
The jobs/funding quests own live eligibility checks and contribution execution.

## Project state and activity

An enrolled project's setup page links to `/projects/github/<owner>/<repo>/state`.
Webhooks reread observations in the background (see below), and a maintainer
can refresh them explicitly with its same-origin form. Each read rereads the default branch at an exact commit using the preview's shared
snapshot reader and validates the Quest tree with the pure core. The authenticated
board and nested quest pages use the existing `Project` seam. Source links retain
the exact commit; live project state never replaces GitHub as authority.

Each refresh advances two passes with independent opaque cursors. The history
pass reads one page of native issues and **all** PRs (including human
contributions and closed/merged PRs); continue reconciliation until it finishes.
A completed history pass detects deleted entities, and refreshing after one starts
again, so missed webhooks and later changes to old entities are recovered. The
occupancy pass reads open PRs and `quest/` branches, the only activity that
decides candidates, and starts again on every refresh after it completes. Its
pages are small, so candidates are normally current after a single refresh no
matter how long the history is. Candidates remain pending while the occupancy
pass is incomplete or a webhook has invalidated it.
This deliberately avoids GitHub's bounded, delayed activity feed; GitHub does
[not automatically redeliver failed webhooks](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).
There is no scheduled background poll in this stage.

Each webhook that names an issue or PR (a comment on a PR names the PR by its
number), or that invalidates candidates (below), asks for a background read of its enabled project once its delivery commits.
The read runs after the response (`waitUntil`) with the App's read-only,
repository-scoped installation token, and is the same read as a refresh: one
page of each pass, plus every entity a webhook named since it was last read,
fetched by number in the same GraphQL query. A new issue or PR therefore shows
its title and state after one read however far the history pass is from it,
and a closed one stops showing as open. A lease in `github_project_state` lets
one read run at a time per project: it answers every request made before it
started, requests made during it get one more read, and duplicate deliveries
never reach it, so a burst costs one or two reads rather than one each. A
per-entity webhook count lets a read clear only the updates it saw. One
invocation reads at most three rounds, to stay within a Worker's subrequest
budget; a request left after them waits for the next webhook or a refresh.
Paused and disconnected projects are not read. A failed or rate-limited read is
recorded and shown next to the refresh fallback, and is not retried: only a
request made during it, such as the webhook whose revision bump failed it, gets
another round, and otherwise the next webhook or a refresh reads again. Checks, statuses and other pushes name no entity and
change no candidate, so they cost no read.

The inbox also treats a PR whose row still says open as closed once a
complete, current occupancy pass no longer lists it, so a missed close webhook
corrects itself on the next read.

A single GraphQL activity query reads up to 50 issues, 50 PRs, 100 open PRs and
100 branch claims, keeping external request count independent of entity/file counts. Bulk
D1 writes use `json_each`, avoiding a query per entity or SQLite's parameter
limit. A revision comparison commits each page and cursor atomically; concurrent
refreshes or an intervening webhook cannot publish over a newer observation.
Only a PR opening, closing, reopening or receiving new commits, a `quest/` branch
being created or deleted, or a push to the default branch invalidates candidates
and restarts the occupancy pass; new work waits for the next read, so a job
binds the PR head and tree the maintainer saw. Checks, statuses, comments,
reviews and other pushes do not invalidate candidates, so a busy repository
neither withholds candidates nor races a refresh. Installation tokens remain read-only,
repository-scoped, and revoked after use.

Durable activity items use the GitHub repository ID, entity kind and full database
ID. GitHub's GraphQL `fullDatabaseId` strings and webhook numeric IDs map to the
same stored text key. Duplicate delivery IDs, redelivery with new IDs, later
pushes/comments/reviews, and reconciliation all update the same item. Webhooks
retain identity pointers only, never issue/PR bodies. Authoritative API reads add
escaped titles, state, comment/review counts, current PR head, that head's check
rollup, aggregate review decision, and up to 20 latest reviewer records with an
explicit pagination flag. Raw bodies and individual check logs are not cached.
Unavailable/deleted entities retain their notification identity and are marked
missing rather than disappearing or presenting old state as current.

A PR associates with a quest only when its head branch exactly matches the quest's
path without `.md` (or an epic's `/README.md`). An unrelated human PR remains in
activity without a guessed association. Open associated PRs and observed quest
branch claims exclude that quest from candidate data; branch claims display as
Claimed on the board. Runner/run associations belong to job coordination.

Every cached read and refresh proves current maintainer authority, live repository
identity/public visibility, installation access, and enrollment for that
installation. Refresh rechecks those boundaries after provider reads. A
background read has no user, so it checks the same boundaries except maintainer
authority; it publishes observations only, and grants or caches no authority.
Every page and action still rechecks the maintainer acting on it. Paused
projects remain readable but have no candidates. Disconnect cascades cached
snapshots and activity; explicitly enrolling a replacement installation clears
prior observations. No positive authority cache is created. Candidate data is an
observation tied to its commit, **never execution permission**: job coordination
must validate current eligibility, fresh revision, locks, and PRs before a start.
Review/check data is similarly descriptive and cannot approve a merge.

The `/data` endpoint exposes the same authenticated snapshot/activity with
`Cache-Control: no-store` for future decision and job consumers. The activity
page is a secondary read view; the durable decision inbox and its unread/answer
state belong to the prompts workflow. Neither incoming activity nor refreshing
starts a model, creates a quest/job, spends usage, or writes to GitHub.
