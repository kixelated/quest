# Quest Worker

A deployable foundation for Quest on Cloudflare, and the site at
`https://kix.quest`: the quest log for your repo and your agents, on the web.
Hono serves HTML directly, so there is no client bundle; only passkeys need a
small script (`src/passkey.js`). Every page renders
inside the shared layout in `src/layout.tsx`, which follows
[the quest log theme](../design/theme.md): the home page (`src/home.tsx`), the
docs under `/docs` (`src/docs.tsx`), the quest board under `/repos`
(`src/board/`), sign-in in the nav, and the not-found page. App pages extend
the layout (breadcrumbs, the status marker, the paste box) rather than adding
a second shell.

The quest board at `/repos/<name>` opens on each milestone with its progress, then
its epics and quests with their statuses, filtered by status with
`?show=available` and the like. Each quest has a page at its path without
`.md`, such as `/repos/quest/quest/m0/kix/prompts`: its Markdown rendered
with raw HTML escaped, its status, and what to do next. Readiness comes from
`quest/core`, so the board agrees with `quest ready`. Progress counts finished
quests, which merges delete, from Git history (`scripts/history.ts`), weighted
by size. A deletion counts only when its commit changed something outside
`quest/`, since deleting only plans abandons a quest.

`scripts/build.ts` runs before every check, test, dev server, and deploy. It
renders the repository's `docs/*.md` into `build/docs.json`, so the Markdown
stays the single source and its relative links keep working on GitHub: links to
other docs become `/docs/<name>` and other repository paths point at GitHub. It
also snapshots this repository's `quest/` tree and finished quests into
`build/board.json`, which supplies the public board. Enrolled repositories use authenticated
GitHub snapshots through the same board model. A shallow clone has no
history, so its board shows no finished work. It also copies `design/theme/` and `src/site.css` into `build/public/`, which the
Worker serves as static assets (`/theme/theme.css`, `/theme/logo.svg`,
`/theme/og.png`, and `/site.css`). `build/` is ignored by Git.

Better Auth uses D1 for accounts and sessions;
adding social providers or plugins belongs in `src/auth.ts`. It handles OAuth
state, cookies, and callbacks. Form routes enforce the configured origin before
calling Better Auth's server API.

### Sign-in methods

People sign in at `/sign-in` with GitHub, Google (when configured), or a
passkey, and manage their methods at `/account`. Every method reaches the same
local account, but repository authority comes only from the account's linked
GitHub identity and the App installation (`src/github/service.ts`); Google and
passkeys never grant it on their own.

- **Linking is explicit.** A signed-in person links another provider from
  `/account`, proving ownership through its OAuth flow; the emails may differ.
  A matching email never links accounts: signing in with a new provider whose
  email belongs to an existing account fails with instructions to link it.
- **One identity per provider.** A provider identity belongs to one account, and
  an account links at most one of each provider, so the GitHub identity behind
  repository authority is unambiguous. Account merging is not supported.
- **No unlinking yet.** Better Auth's unlink endpoint is disabled, so an account
  cannot strand itself without GitHub authority or a way back in.
- **Passkeys** enroll from `/account` on a session less than a day old, and
  require user verification (a PIN, biometric, or equivalent) to enroll and to
  sign in. Removing one needs the signed-in owner. Recovery is through another
  passkey or a linked provider; there is no administrator bypass.
  `src/passkey.js` drives the browser's WebAuthn JSON helpers directly; where a
  browser lacks them, the passkey buttons stay hidden.

The passkey relying party is the hostname of `AUTH_URL`, and its exact origin
is the only one accepted. Changing the hostname orphans existing passkeys;
people enroll new ones after signing in with a provider.

GitHub is authoritative for enrolled project state. D1 holds accounts,
sessions, GitHub App state, and jobs. The R2 bucket bound as `OUTPUT` holds raw
agent output. The one Durable Object, `RunnerHub`, holds runners' live
connections and keeps no records of its own.

### Jobs

A job is one maintainer-authorized workflow (`plan`, `start`, `iterate`, or
`bootstrap`) on one target, pinned to a revision (`src/jobs/`). Maintainers
create, answer, and cancel jobs at `/projects/github/<owner>/<repo>/jobs`, and
every request rechecks current GitHub authority. `start` takes only quests that
observations show ready and unclaimed. `iterate` jobs are untrusted and route
only to Linux runners that declare VM builds. Without a `flake.nix`, the route
offers a `bootstrap` job instead. A paused project gets no new jobs and none are
claimed; resuming it dispatches the jobs that waited. Disconnecting a project
deletes its jobs and their output and tells their runners to stop. Duplicate
requests return the active job for the same target.

Runners are a user's own machines. Each one registers at `POST /api/runners`
and gets a bearer token, which kix stores only as a hash. With that token a
runner opens a WebSocket at `/api/runner/connect`. The connection goes to its
owner's `RunnerHub` (`src/jobs/hub.ts`), the one place that owner's jobs are
routed, and the open connection is the runner's presence.

Over the socket the runner sends `status` messages: its opaque accounts, the
attempts it is running, and its free job slots. It also sends `checkpoint`,
`question`, `output`, and `result` messages. Each gets a `reply` with the same
`id` (`src/jobs/protocol.ts`). The hub pushes `assign` and `cancel` messages
whenever jobs or connections change. A status that lists an assigned attempt
acknowledges it; until then the assignment holds one of the runner's slots and
the hub resends it, and cancelling a
job whose assignment was never acknowledged stops it at once.

Routing gives a job to the connected runner with a free slot and the owner's
most preferred usable account. A pin, the job's trust, or a paused session's
home runner can override that. Each assignment increments the job's attempt.
Runner messages name their attempt and land only while it is current.

When a runner disconnects, its running jobs get a two-minute grace deadline.
The hub's alarm moves them once it passes, so a returning runner is fenced out.
A status that omits an acknowledged job gives it up at once.

An account limit pauses the job with an account decision; kix never switches
accounts on its own. An answer requeues the job and resumes its session on the
runner that holds it.

### Raw output

Runners upload raw agent output as `output` messages of at most 1 MiB of UTF-8
(`src/jobs/output.ts`). Each attempt numbers its chunks with a contiguous `seq`
from 0 and sends them in order: kix accepts only the attempt's next `seq`,
once the chunk before it is stored, or an identical retry of a chunk it still
holds, which succeeds without writing again. A different chunk with a used `seq` is refused, and so is a retry of an
expired one. Each chunk is one R2 object at `output/<job>/<attempt>/<seq>`,
readable as soon as it lands, and D1 keeps a small index row per chunk plus each
attempt's totals.

An attempt keeps at most 64 MiB and 4096 chunks. The chunk that would pass
either cap, and every later one, gets a reply with `truncated: true` instead of
an error; the job keeps running and its summaries are unaffected. Expiring
chunks never give that capacity back.

Maintainers read output at `GET /projects/github/<owner>/<repo>/jobs/<job>/output`,
in pages of four chunks ordered by `(attempt, seq)`; `?after=<attempt>.<seq>`
continues from a page's `next`, and `truncated` lists the attempts that reached
the cap. Every request rechecks current maintainer authority.

Output is kept for 30 days from each chunk's upload. A bucket lifecycle rule
deletes `output/` objects, and a daily cron (`triggers.crons` in
`wrangler.jsonc`) deletes their index rows; reads skip a row whose object is
already gone. Disconnecting a project queues its jobs' output for deletion in
the same D1 batch that deletes the jobs, then deletes each `output/<job>/`
prefix at once. The cron retries any deletion that failed. An upload racing the
disconnect finds its index row gone, queues its job's prefix for the cron again,
and deletes its own object.

`cloudflare/` is a Bun workspace of the repository root, so the Worker
imports the CLI's core as `quest/core` (`../src/core`), the same parser, checks,
and readiness the CLI runs.

## Development

From the repository root:

```sh
nix develop
just install
cp cloudflare/.dev.vars.example cloudflare/.dev.vars
```

Fill in the local file with a random `AUTH_SECRET` (at least 32 characters) and
GitHub OAuth app credentials. Google sign-in is optional and off by default:
to try it, register a Google OAuth web client with redirect URI
`http://localhost:8787/api/auth/callback/google`, set both Google values in
the local file, and temporarily list `GOOGLE_CLIENT_SECRET` under
`secrets.required` in `wrangler.jsonc`, because Wrangler dev loads only declared
secrets. Configure the GitHub app's homepage as
`http://localhost:8787` and callback as
`http://localhost:8787/api/auth/callback/github`. The file is ignored by Git.
Its `AUTH_URL` overrides the production origin in `wrangler.jsonc`. Use a
separate OAuth app for production.

```sh
just worker-dev
```

This applies local D1 migrations and starts Wrangler. Open
`http://localhost:8787`, sign in, and sign out. `/health` reports process health;
it does not probe storage. `/setup` redirects to `SETUP.md` on GitHub, so the
one-line setup paste can use `https://kix.quest/setup`. D1 persists locally
under `cloudflare/.wrangler/`. There are no remote-only bindings: local
development and tests need no Cloudflare login. Wrangler reruns the build when
`src/`, `scripts/`, or `docs/` change.

## Checks

```sh
just check
just test
```

These include the Worker and run in the existing Linux/macOS Nix CI jobs.
`just worker-check` checks generated binding types, TypeScript, formatting, and
`wrangler deploy --dry-run`. `just worker-test` runs workerd integration tests
with real local D1. Tests cover the home page and rendered docs in the shared
layout, the board and quest pages, statuses, progress, safe Markdown, and
finished quests from history, the mocked GitHub OAuth callback, persisted
sessions, sign-out, and rejected origins/invalid state. Login tests mock GitHub
and Google OAuth and run real P-256 WebAuthn registration and assertions: the
linking rules, collisions, passkey user verification, origin, signature,
replay, and ownership. Job tests race dispatch passes, reassign a disconnected
runner's job and fence its late writes, and cover routing, questions, account
limits, and cancellation. They drive real WebSocket connections through the hub,
including a replaced connection and the alarm that reassigns work, and check the
maintainer-only routes. Output tests use local R2 for chunk ordering, retries,
the caps, expiry, and cleanup after a disconnect. No OAuth credentials or
Cloudflare account are required for checks.

After changing bindings, regenerate types:

```sh
bun run --cwd cloudflare types
```

Wrangler is a dependency pinned in the root `bun.lock` and shared with the
test plugin; the Nix shell does not provide it. Use `bun run wrangler` from
`cloudflare/` for the documented deployment commands so generated types and
deployment use that same version, on Bun (`cloudflare/bunfig.toml`).

## Deployment

Deployment is manual. This scaffold does not provision resources or deploy
from CI. In the Nix shell, enter `cloudflare/` and authenticate:

```sh
cd cloudflare
bun run wrangler login
bun run wrangler d1 create quest-auth
bun run wrangler r2 bucket create quest-output
bun run wrangler r2 bucket lifecycle add quest-output output-expiry output/ --expire-days 30
```

The lifecycle rule is bucket configuration, not part of `wrangler.jsonc`, so
check it on an existing bucket with
`bun run wrangler r2 bucket lifecycle list quest-output`. Keep it at the
30 days the Worker's cron uses (`RETENTION` in `src/jobs/output.ts`).

The checked-in config deploys to `https://kix.quest` as a Workers custom
domain, which requires the `kix.quest` zone in the same Cloudflare account;
`workers.dev` is disabled so sign-in has one origin. `AUTH_URL` is the only
authentication origin and supplies generated absolute links.

For an existing deployment, retain the Worker name, D1 database ID, and
`AUTH_SECRET` so account data is preserved. The `create` commands above are
for a fresh deployment only. For another environment, change `routes`,
`AUTH_URL`, Worker name, account, database, bucket, and OAuth credentials
together.

Register the production GitHub OAuth app with callback
`https://kix.quest/api/auth/callback/github`. For Google sign-in, also register
a production Google OAuth web client with redirect URI
`https://kix.quest/api/auth/callback/google`, set its public client ID as
`GOOGLE_CLIENT_ID` in `wrangler.jsonc`, and set the secret with
`bun run wrangler secret put GOOGLE_CLIENT_SECRET`; without both, Google is
not offered. The secret is optional, so it is not listed under `secrets.required`. Deploys fail until every
required secret is set, so register the GitHub App first ([GITHUB.md](GITHUB.md)
steps 1 and 2), then set secrets interactively:

```sh
bun run wrangler secret put AUTH_SECRET
bun run wrangler secret put GITHUB_CLIENT_ID
bun run wrangler secret put GITHUB_CLIENT_SECRET
bun run wrangler secret put GITHUB_APP_PRIVATE_KEY
bun run wrangler secret put GITHUB_WEBHOOK_SECRET
bun run wrangler d1 migrations apply DB --remote
bun run types
bun run check
bun run deploy
```

D1 schema migrations are applied separately before deployment. The `exports`
tombstone in `wrangler.jsonc` deletes the legacy `RepositoryCoordinator`
Durable Object namespace, and any storage it held, from Workers deployed before
it was removed; Wrangler reports a stale tombstone where none exists. Remove the
tombstone after the next production deploy. This does not affect the D1 auth
database. The same `exports` block creates the SQLite-backed `RunnerHub` class
bound as `RUNNERS`; it stores only its owner's ID, so it needs no data migration.

After deploying, verify `/health`, `/setup`, and a theme asset, then complete
sign-in/sign-out in the browser.

The auth schema migration is checked in for review. When upgrading Better Auth
or adding a plugin, generate/review its schema changes and add a D1 migration;
do not migrate the production database on HTTP requests.

References: [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[Better Auth database](https://better-auth.com/docs/concepts/database), and
[Hono integration](https://better-auth.com/docs/integrations/hono).

The server-only GitHub App integration, reviewed manifest, permission rationale,
webhook lifecycle and operator registration are documented in [GITHUB.md](GITHUB.md).
