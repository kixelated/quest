# Review and merge changes

A push to `refs/heads/quest/...` on a registered contributor fork creates a
change against upstream main. After intake authenticates the Artifacts push
subscription, `ChangeChecks` evaluates the complete candidate tree with the
same Rust core as the CLI. Repository scripts, hooks, build commands and agents
are never executed during these checks.

Maintainers open `/repos/REPOSITORY/changes`; contributors can open their own
change at `/repos/REPOSITORY/changes/FORK?branch=quest/PATH&head=COMMIT_SHA`.
The page displays the exact candidate diff, conflicts, core findings and
comments. A new quest proposal uses this same flow. Automatic Claim removal
is part of the displayed, checked tree.

Comments, successful/failed checks and approvals are stored on immutable fork
commits in upstream `refs/notes/quest`. Contributors can comment on their own
fork; only the registered maintainer can approve or merge. Approval and merge
require a successful check for the current fork head, upstream head and
candidate tree. A moved head invalidates prior checks and approvals. Fetch
notes explicitly when reading reviews from an agent:

```sh
git fetch UPSTREAM refs/notes/quest:refs/notes/quest
git notes --ref=quest show COMMIT_SHA
```

The repository coordinator serializes every upstream write, including intake,
Claim expiry, notes and merges. A merge uses real Git, removes the matching
quest Claim, creates a two-parent commit and pushes normally. Conflicts never
write upstream. Reachable Git operation markers recover landed writes and
merges after a lost response; notes recover from their trusted upstream
operation ID. Public Git credit names identify the verified provider account,
with a stable no-reply address; login email addresses stay private.

Git ancestry closes merged heads even when contributors retain their branches.
Delayed or duplicate push events cannot reopen the same merged head; a newer
fork commit can create another change. The D1 changes table is a disposable
index rather than merge or approval authority.

## Runtime and verification

`GitSandbox` uses the current native Container API: `container.start` and fixed
argv `container.exec`. The dedicated `Dockerfile.git` contains Git and CA
certificates. Each operation initializes a fresh bare repository, scopes a
short-lived Artifacts credential to its remote, and deletes the repository
when finished. No credentials are stored in repository config or command
arguments. Workflows and the Git Durable Object binding are declared in
`wrangler.jsonc`; deployment also needs the intake Queue, subscription secret
and operator configuration in [INTAKE.md](INTAKE.md#configuration).

`just check` validates generated types and the Worker bundle without rolling
out container images. Linux CI separately builds the Git image with Docker.
`just test` combines local workerd/D1/coordinator tests with real Git fixtures
for directory inventories, safe credit, stale heads, conflict safety, prepared
diffs, notes and operation recovery. Tests omit the remote-only Artifacts
binding and never use a Cloudflare account.

The image has been built locally and its Git binary exercised. Live Container,
Artifacts transport, Queue/Workflow delivery and browser review-to-merge must
still be verified in the configured deployment as part of the parent
Cloudflare quest. Local bundle checks do not confirm that operator setup.

References: [Container API](https://developers.cloudflare.com/containers/api/durable-object-container/),
[Artifacts Git authentication](https://developers.cloudflare.com/artifacts/guides/authentication/),
[Workflow API](https://developers.cloudflare.com/workflows/build/workers-api/).
