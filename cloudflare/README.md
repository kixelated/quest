# Quest Worker

A deployable foundation for Quest on Cloudflare, and the site at
`https://kix.quest`: the quest log for your repo and your agents, on the web.
Hono serves HTML directly, so there is no client bundle. Every page renders
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
`build/board.json`, which is the board's only project until the GitHub project
state integration supplies enrolled repositories. A shallow clone has no
history, so its board shows no finished work. It also copies `design/theme/` and `src/site.css` into `build/public/`, which the
Worker serves as static assets (`/theme/theme.css`, `/theme/logo.svg`,
`/theme/og.png`, and `/site.css`). `build/` is ignored by Git.

Better Auth uses D1 for accounts and sessions;
adding social providers or plugins belongs in `src/auth.ts`. It handles OAuth
state, cookies, and callbacks. Form routes enforce the configured origin before
calling Better Auth's server API.

The unused Artifacts and repository Durable Object bindings are disconnected.
GitHub remains the planned authority for enrolled project state. The legacy
`RepositoryCoordinator` export and its `v1` migration remain solely to preserve
any deployed storage until operator-approved cleanup; no application route can
reach it. D1 retains the existing accounts and sessions.

`cloudflare/` is an npm workspace of the repository root, so the Worker
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
GitHub OAuth app credentials. Configure the GitHub app's homepage as
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
sessions, sign-out, and rejected origins/invalid state. No OAuth credentials or
Cloudflare account are required for checks.

After changing bindings, regenerate types:

```sh
npm run types -w cloudflare
```

Nix provides Node and Wrangler for interactive use. Recipes use the newer
Wrangler pinned in the root `package-lock.json`, which is also used by the test plugin.
Use `npm exec -- wrangler` from `cloudflare/` for the documented deployment
commands so generated types and deployment use that same version.

## Deployment

Deployment is manual. This scaffold does not provision resources or deploy
from CI. In the Nix shell, enter `cloudflare/` and authenticate:

```sh
cd cloudflare
npm exec -- wrangler login
npm exec -- wrangler d1 create quest-auth
```

The checked-in config deploys to `https://kix.quest` as a Workers custom
domain, which requires the `kix.quest` zone in the same Cloudflare account;
`workers.dev` is disabled so sign-in has one origin. `AUTH_URL` is the only
authentication origin and supplies generated absolute links.

For an existing deployment, retain the Worker name, D1 database ID, and
`AUTH_SECRET` so account data is preserved. The `d1 create` command above is
for a fresh deployment only. For another environment, change `routes`,
`AUTH_URL`, Worker name, account, database, and OAuth credentials together.

Register the production GitHub OAuth app with callback
`https://kix.quest/api/auth/callback/github`. Deploys fail until every
required secret is set, so register the GitHub App first ([GITHUB.md](GITHUB.md)
steps 1 and 2), then set secrets interactively:

```sh
npm exec -- wrangler secret put AUTH_SECRET
npm exec -- wrangler secret put GITHUB_CLIENT_ID
npm exec -- wrangler secret put GITHUB_CLIENT_SECRET
npm exec -- wrangler secret put GITHUB_APP_PRIVATE_KEY
npm exec -- wrangler secret put GITHUB_WEBHOOK_SECRET
npm exec -- wrangler d1 migrations apply DB --remote
npm run types
npm run check
npm run deploy
```

D1 schema migrations are applied separately before deployment. Keep the
existing `v1` Durable Object migration and unbound class export until the
operator has inspected any legacy data and explicitly approved permanent
storage cleanup. No deletion migration is included: deleting that class would
permanently remove its stored data. This does not affect the D1 auth database.

After deploying, verify `/health`, `/setup`, and a theme asset, then complete
sign-in/sign-out in the browser.

The auth schema migration is checked in for review. When upgrading Better Auth
or adding a plugin, generate/review its schema changes and add a D1 migration;
do not migrate the production database on HTTP requests.

References: [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[Better Auth database](https://better-auth.com/docs/concepts/database), and
[Hono integration](https://better-auth.com/docs/integrations/hono).

The server-only GitHub App integration, reviewed manifest, permission rationale,
webhook lifecycle and operator registration are documented in [GITHUB.md](GITHUB.md).
