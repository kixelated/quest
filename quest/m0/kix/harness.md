# [M] Run the Worker locally with seeded data

## Goal

One checked-in command, such as `just dev-seeded`, serves the real Worker
locally with representative seeded data, mocked GitHub, and a local sign-in,
so agents and maintainers can check UI changes in a browser at phone and
desktop widths. It works inside sandboxed agent environments, where
`wrangler dev` currently hangs.

## Plan

Decided 2026-10-19 as a follow-up of the decision inbox (#144). Its
browser check needed a throwaway harness because `wrangler dev`'s internal
proxy hangs in the agent sandbox on a DNS lookup of "dummy":

- Check in a seeded harness rather than debugging `wrangler dev` for one
  agent environment. Bundle the Worker as `wrangler deploy --dry-run` does,
  serve it with Miniflare on local D1 and R2, and apply the checked-in
  migrations.
- Mock GitHub's REST API and short-circuit the OAuth redirect so sign-in
  completes locally. The mock serves only localhost and never holds real
  credentials; it is development tooling, not a production code path.
- Seed representative state: agent prompts with several questions, an
  account limit, failed, queued and running jobs, PRs with checks and
  reviews, issues including a pointer-only one and a long title, ready
  quests, and a paused project.
- Keep the seed and mock reusable as the base for the kix epic's stubbed
  end-to-end test, rather than a second fixture set. Share fixtures with
  the Worker tests where practical.
- Document the command in `cloudflare/README.md` as the way to check UI
  changes in a browser.
