# Quest Worker

A deployable foundation for Quest on Cloudflare. Hono serves HTML directly, so
there is no separate client build. Better Auth uses D1 for accounts and sessions;
adding social providers or plugins belongs in `src/auth.ts`. It handles OAuth
state, cookies, and callbacks. Form routes enforce the configured origin before
calling Better Auth's server API.

`ARTIFACTS` points at one namespace per deployment, with each project stored as
an Artifacts repository. `REPOSITORIES.getByName(artifactsRepoName)` selects its
SQLite Durable Object. The coordinator currently initializes its schema and
exposes an internal status method. Repository authorization, creation, claims,
changes, and the board belong to later quests; there are no public repository
or token routes yet. The Rust CLI remains independent of the Worker. Both use
the same Rust core for Markdown validation and readiness.

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
The scaffold does not call Artifacts yet. Use a separate development namespace
before adding repository operations. Integration tests explicitly omit this
binding so tests and CI never need Cloudflare credentials or call live services.

## Shared Rust core

`just wasm-build` builds the Rust library for `wasm32-unknown-unknown` and creates
the ignored local `quest-core/` module with the pinned `wasm-bindgen` tool. Worker
check, test, dev, and deploy commands build it automatically. Wrangler bundles
the precompiled module; request handling performs no dynamic compilation.

`src/core.ts` exports `evaluate({ documents, paths }, questPath?)`. Supply the
complete quest tree as Markdown bodies and an explicit inventory of existing
repository-relative files/directories, including ordinary nonquest assets. The
result contains findings, ready paths, optional blockers for the requested quest,
and structured Claim fields. Paths in results use `quest/...`; the optional
quest path also accepts `/quest/...`. The parser, rules, and readiness expansion
are the same implementation used by the native CLI. Git overlays and repository
fetching remain adapters.

`readSnapshot(repo, commitSha, limits?)` in `src/snapshot.ts` reads a pinned
Artifacts commit and returns all tree entries with modes/hashes, all Markdown
bodies (including issues), and the path inventory. Defaults cap it at 10,000
entries, 1 MiB per read blob, and 16 MiB of total reads. Invalid UTF-8, missing
objects, invalid paths, and exceeded limits throw `SnapshotError`; Artifacts
service errors propagate separately. UTF-8 BOMs and line endings are preserved.

Native checks use live filesystem existence, including untracked files and
symlink resolution. Artifacts snapshots include tracked paths only, resolve
repository-internal symlinks, and expose directory symlink aliases for ordinary
links. They cannot see external symlink targets or submodule contents. Broken or
external Markdown symlinks fail the read, rather than silently dropping a quest.

`removeClaim(content)` removes the one valid Claim section using the Markdown
parser's byte range and preserves every other byte. Invalid or ambiguous Claims
throw. `isClaimAddition(before, after)` compares a Claim-only edit and permits
only the minimal blank separator inserted immediately before its heading.
`readTreeSnapshot(reader, treeHash, limits?)` uses the same object traversal for
Sandbox Git candidate trees without creating a temporary commit. Identity and
ownership authorization stay with the calling application.

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
and coordinator storage across eviction and repository boundaries. Wasm tests
execute the compiled module in workerd and cover readiness, ordinary links,
Claim edits, and complete immutable snapshots. Native parity tests also
cover untracked assets and symlinks. No OAuth credentials or Cloudflare account
are required for checks.

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
