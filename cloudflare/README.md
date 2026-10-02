# Quest Worker

A deployable foundation for Quest on Cloudflare. Hono serves HTML directly, so
there is no separate client build. Better Auth uses D1 for accounts and sessions;
adding social providers or plugins belongs in `src/auth.ts`. It handles OAuth
state, cookies, and callbacks. Form routes enforce the configured origin before
calling Better Auth's server API.

`ARTIFACTS` points at one namespace per deployment, with each project stored as
an Artifacts repository. `REPOSITORIES.getByName(artifactsRepoName)` selects its
SQLite Durable Object. The coordinator serializes upstream mutations and tracks claim expiry. Signed-in
contributors receive their own forks and scoped tokens; push intake validates
complete immutable snapshots with the Rust core before crediting allowed claims
or issues onto main. See [fork intake](INTAKE.md) for routes, authorization,
Queue configuration and warning-hook limitations. The Rust CLI remains
independent of the Worker.

## Development

From the repository root:

```sh
nix develop
just worker-install
cp cloudflare/.dev.vars.example cloudflare/.dev.vars
```

Fill in the local file with a random `AUTH_SECRET` (at least 32 characters) and
GitHub OAuth app credentials. Configure the GitHub app's homepage as
`http://localhost:8787` and callback as
`http://localhost:8787/api/auth/callback/github`. The file is ignored by Git.
Use a separate OAuth app for production.

```sh
just worker-dev
```

This applies local D1 migrations and starts Wrangler. Open
`http://localhost:8787`, sign in, and sign out. `/health` reports process health;
it does not probe storage. D1 and the coordinator persist locally under
`cloudflare/.wrangler/`.

Artifacts is remote-only, even in Wrangler local mode. Wrangler requires an
account login (`cd cloudflare; npm exec -- wrangler login`) for that binding.
Repository operations call Artifacts. Use a separate development namespace. Integration tests explicitly omit this
binding so tests and CI never need Cloudflare credentials or call live services.

## Checks

```sh
just check
just test
```

These include the Worker and run in the existing Linux/macOS Nix CI jobs.
`just worker-check` checks generated binding types, TypeScript, formatting, and
`wrangler deploy --dry-run`. `just worker-test` runs workerd integration tests
with real local D1 and SQLite Durable Objects. Tests cover the mocked GitHub
OAuth callback, persisted sessions, sign-out, rejected origins/invalid state,
coordinator storage across eviction and repository boundaries, fork ownership,
push gates, mutation recovery and claim expiry. No OAuth
credentials or Cloudflare account are required for checks.

After changing bindings, regenerate types:

```sh
npm --prefix cloudflare run types
```

Nix provides Node and Wrangler for interactive use. Recipes use the newer
Wrangler pinned in `package-lock.json`, which is also used by the test plugin.
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

Copy the returned database ID into `wrangler.jsonc`; the checked-in all-zero ID
is a local placeholder. Set `AUTH_URL` to the Worker's public HTTPS origin and
choose the Worker name, account, and Artifacts namespace for this deployment.
The namespace may be created explicitly with Wrangler or is created on the
first repository creation. Use different namespaces, databases, Workers, and
OAuth credentials for each deployment environment.

Register the production GitHub OAuth app with callback
`https://YOUR_PUBLIC_ORIGIN/api/auth/callback/github`, then set secrets
interactively:

```sh
npm exec -- wrangler secret put AUTH_SECRET
npm exec -- wrangler secret put GITHUB_CLIENT_ID
npm exec -- wrangler secret put GITHUB_CLIENT_SECRET
npm exec -- wrangler d1 migrations apply DB --remote
npm run types
npm run check
npm run deploy
```

Configure the Queue, subscription secret and operator allowlist described in
[the intake setup](INTAKE.md#configuration) before deployment.

Wrangler deploy applies the SQLite Durable Object class migration. D1 schema
migrations are applied separately before deployment. After deploying, verify
`/health` and complete sign-in/sign-out in the browser. No live deployment or
provider registration was performed while creating this scaffold.

The auth schema migration is checked in for review. When upgrading Better Auth
or adding a plugin, generate/review its schema changes and add a D1 migration;
do not migrate the production database on HTTP requests.

References: [Artifacts binding](https://developers.cloudflare.com/artifacts/api/workers-binding/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[Better Auth database](https://better-auth.com/docs/concepts/database), and
[Hono integration](https://better-auth.com/docs/integrations/hono).
