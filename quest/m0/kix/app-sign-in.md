# [S] Sign in through the GitHub App

## Goal

GitHub sign-in on kix.quest uses the registered GitHub App's own OAuth
credentials, so one GitHub screen can both sign a maintainer in and install
the App. The operator registers one GitHub integration instead of an App and
a separate OAuth app. Google and passkey sign-in are unchanged.

## Plan

Decided 2026-10-27 (user) while planning a smoother onboarding, where a
maintainer opts in a repository and the bot does the rest:

- Which onboarding changes should this planning round add as quests?
  - ✅ A: bot opens setup PR
  - ✅ C: install then pick repos
  - ✅ C+: App sign-in replaces OAuth app
  - B: setup as a runner job
- With sign-in through the GitHub App, what happens to the separate GitHub
  OAuth app?
  - ✅ Remove it
  - Keep both

  There is no production data to migrate. `GITHUB_CLIENT_ID` and
  `GITHUB_CLIENT_SECRET` become the App's client credentials. Add the
  callback URL `https://kix.quest/api/auth/callback/github` and
  `request_oauth_on_install` to `cloudflare/github-app-manifest.json`, and
  drop the OAuth app from `cloudflare/README.md`'s Deployment section and
  `cloudflare/GITHUB.md`'s operator setup.
- Sign-in still only proves identity: authority stays the live maintain/admin
  check, and the user token is never used to write.
- Keep the seeded server's local GitHub sign-in working.
