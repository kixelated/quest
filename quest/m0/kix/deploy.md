# [XS] Deploy the Worker to kix.quest

## Goal

An operator deploys `main` to `https://kix.quest` and points the production
GitHub OAuth app at it. The condition clears when `https://kix.quest/health`
returns `{"status":"ok"}`, `https://kix.quest/setup` redirects to `SETUP.md`,
and a browser sign-in and sign-out on kix.quest succeed. Follow the Deployment
section of `cloudflare/README.md`; delete this quest once verified.

## Plan

- ✅ Decided 2026-10-14: deprecate kixel.quest without redirects or legacy
  auth handling, because nobody uses it. kix.quest is the only site and
  authentication origin. Remove the Worker's kixel.quest custom domain when
  deploying; the checked-in config no longer lists it.
- Merging to `main` does not deploy: no workflow runs Wrangler, and
  deployment is a manual `npm run deploy` from `cloudflare/`.
- Add the `kix.quest` zone to the Worker's Cloudflare account. Keep the
  Worker name, D1 database ID, and `AUTH_SECRET`; do not create a new
  production database.
- Set the production GitHub OAuth app's homepage to `https://kix.quest` and
  its callback to `https://kix.quest/api/auth/callback/github`.
- The deploy disconnects the unused Artifacts and coordinator bindings but
  keeps the `RepositoryCoordinator` export and `v1` migration. Deleting them
  would permanently remove its storage; that cleanup needs the operator's
  inspection and explicit approval, and is out of scope here.
