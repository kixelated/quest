# GitHub mirroring

A registered Artifacts project can pair with one GitHub repository through the
shared GitHub App. Pairing starts disabled. A maintainer explicitly enables it
only after onboarding's init/hooks PR merges; installation and import never enable
sync. The later onboarding flow can call the same serialized `pairGithub` and
`enableGithub` coordinator methods. The current settings are at
`/repos/ARTIFACTS_REPOSITORY/sync`.

Pairing and enabling require both the registered project's maintainer session
and administrator permission for that session user's linked, verified GitHub
account. GitHub repository and installation IDs are stable server-verified
identities; webhook repository names, commit authors and delivery headers grant
no authority. Disabling sync requires the registered maintainer and stops new
reconciliations, including already queued hints.

## Configuration

Create a GitHub App with repository **Contents: read/write**, **Workflows:
read/write**, and **Metadata: read** permissions. Subscribe to **push** events;
set its webhook URL to `https://YOUR_PUBLIC_ORIGIN/webhooks/github` and choose a
random webhook secret. Install it only on the repositories the service should
mirror. This App is separate from the OAuth app used for sign-in; onboarding
will share this same App. Workflow permission allows mirroring commits that
change `.github/workflows/`.

Set `GITHUB_APP_ID` in `wrangler.jsonc`. Store the downloaded private key and
webhook secret as Worker secrets from the Nix shell in `cloudflare/`:

```sh
npm exec -- wrangler secret put GITHUB_APP_PRIVATE_KEY < /PATH/TO/PRIVATE_KEY.pem
npm exec -- wrangler secret put GITHUB_WEBHOOK_SECRET
npm exec -- wrangler d1 migrations apply DB --remote
```

Use a separate development App and credentials. A local `.dev.vars` can hold
`GITHUB_APP_PRIVATE_KEY` as a quoted PEM with escaped newlines and
`GITHUB_WEBHOOK_SECRET`; never commit that file or the PEM. Configure the
Queue and account-scoped subscription management token from [intake](INTAKE.md).
Enabling registers the upstream Artifacts push subscription on that same Queue.
The `GITHUB_SYNC` Workflow and five-minute cron are declared in `wrangler.jsonc`.
No resources or credentials are provisioned by this code.

Installation tokens are minted for only the paired repository, used as Git HTTP
Basic credentials (`x-access-token`), and revoked after each operation. Artifacts
also uses ephemeral write tokens. Secrets never appear in remote URLs, Git
arguments, repository configuration, D1 status, or UI output.

## Reconciliation

Both providers' authoritative refs are read each time. Only `main`, supported
`quest/**` branches (including dotted and Unicode names) and `refs/notes/quest` participate; tags and other branches
are ignored. Files and note objects travel through Git unchanged. Git executes
fixed argument arrays in a fresh bare container repository with trusted config;
no contributor hooks, scripts, builds or agents run.

Equal refs need no write. A newly observed ref can be created on the other side.
For different existing heads, Git proves ancestry and advances only the lagging
side. An explicit old-SHA lease supplies compare-and-swap, including notes refs;
although Git calls this option `--force-with-lease`, the service requests only
updates already proven to be fast-forward. A concurrent destination update or
provider branch rule rejects the push rather than being overwritten. A
concurrent source change is picked up by the next reconciliation.

Divergence and deletion appear per ref in the settings UI. Deletion is not a
fast-forward: sync neither deletes the other copy nor recreates a previously
observed ref. Maintain the `sync_refs` receipts when restoring the database;
they are safety state, not disposable cache. Receipts are persisted before the
first write, so losing a successful response and then deleting the new copy
cannot resurrect it on retry. A failed or uncertain first copy may require
manual reconciliation; its receipt remains `pending` until a subsequent result.
If both copies exist again, ordinary ancestry checks resume.

Reconcile a conflicted ref explicitly in Git, preserving the desired history,
then use **Sync now**. Sync does not force a divergent history or decide deletion
policy. Independent note additions can produce divergent note commits too;
that conflict is visible and requires the same deliberate reconciliation.

Artifacts Queue envelopes must match the configured account, namespace and
stored subscription. GitHub HMAC-SHA256 validation covers the exact raw body
before stable repository/installation lookup. Authenticated events are hints,
not instructions to write their payload SHA. Duplicate hints get deterministic
Workflow IDs; the cron also covers notes, missed events and interrupted runs.
All reconciliation and enable/disable operations use the same repository FIFO
as intake and change merges. Workflow step results copy plain values out of RPC
handles before serialization.

Transport failures remain failed Workflow runs and can be inspected by the
operator; the next scheduled reconciliation reads current refs again. The UI
shows the last stored ref result. This implementation has local real-Git,
workerd RPC/Workflow and mocked provider API coverage. Live App permissions,
webhook delivery, Artifacts/GitHub transport and branch protection must be
verified after operator configuration; none were provisioned during development.

References: [GitHub App tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[Git push leases](https://git-scm.com/docs/git-push), and
[Artifacts push subscriptions](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/).
