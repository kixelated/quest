# [S] Deploy the Worker to kix.quest

## Goal

An operator registers the GitHub App and deploys `main` to `https://kix.quest`
with GitHub sign-in pointed at it. The condition clears when
`https://kix.quest/health` returns `{"status":"ok"}`, `https://kix.quest/setup`
redirects to `SETUP.md`, a browser sign-in and sign-out on kix.quest succeed,
and the App's ping to `https://kix.quest/webhooks/github` shows a successful
delivery. Follow the Deployment section of `cloudflare/README.md` and steps 1,
2 and 4 of `cloudflare/GITHUB.md`; delete this quest once verified.

## Plan

- ✅ Decided 2026-10-14: deprecate kixel.quest without redirects or legacy
  auth handling, because nobody uses it. kix.quest is the only site and
  authentication origin. Remove the Worker's kixel.quest custom domain when
  deploying; the checked-in config no longer lists it.
- Merging to `main` does not deploy: no workflow runs Wrangler, and
  deployment is a manual `bun run deploy` from `cloudflare/`.
- Every deploy of `main` fails until the required secrets `AUTH_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` and
  `GITHUB_WEBHOOK_SECRET` are set, so register the App from
  `cloudflare/github-app-manifest.json` first. Review its permissions and
  events before registering, and set `GITHUB_APP_ID`. Keep secrets out of
  git and agent worktrees.
- Apply the D1 migrations, including `0002_github.sql`, with
  `bun run wrangler d1 migrations apply DB --remote` before deploying.
- Add the `kix.quest` zone to the Worker's Cloudflare account. Keep the
  Worker name, D1 database ID, and `AUTH_SECRET`; do not create a new
  production database.
- Set the production GitHub OAuth app's homepage to `https://kix.quest` and
  its callback to `https://kix.quest/api/auth/callback/github`.
- The deploy deletes the legacy `RepositoryCoordinator` Durable Object and
  any storage it held, approved 2026-10-14 since nothing is stored. Afterwards
  remove its `exports` tombstone from `cloudflare/wrangler.jsonc`.
