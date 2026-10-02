# Quest on Cloudflare

## Goal

Maintainers scope quests and milestones in a repository hosted on Cloudflare
Artifacts. Any outside contributor signs in, locks a ready quest, and donates
their own agent tokens to run it, either locally (`quest run`, signed in with
ChatGPT) or in a hosted Cloudflare Sandbox (their stored API key). The result
arrives as a change that maintainers review and merge in a web UI. Outsiders
file issues and claims from their forks; everything stays in git and syncs
two-way with GitHub. GitHub support in Quest's core keeps working unchanged.

This is also the entry for Cloudflare's "next Git platform" competition:
an open-source repository, run instructions, and a 5-10 minute demo video,
submitted by 2026-10-14 11:59 PM PDT.

This README owns the work no child does: an end-to-end test (a fresh repository
goes through fork, claim, run with a stub agent, change, review, merge, and
GitHub sync), `docs/cloudflare.md` (deploying the app, onboarding a repository,
contributing tokens), a README section, and the recorded demo and submission.

## Plan

Decided while planning on 2026-10-01. Research sources:
[Artifacts docs](https://developers.cloudflare.com/artifacts/),
[competition terms](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf),
[Sign in with ChatGPT for open source](https://developers.openai.com/siwc/token-sharing-open-source).

- The competition is the launch. Judging weighs the originality of agent
  collaboration (50%), multi-agent coordination and conflict handling (25%),
  and ease of use (25%). Locks are how concurrent donated runs avoid stepping
  on each other, so the demo should show that.
- Code lives in this repository under `cloudflare/` as a TypeScript Worker,
  kept apart from the Rust core. The Nix shell gains node and wrangler, and CI
  gains a job.
- Everything is git-based so it syncs with GitHub. Claims are a `## Claim`
  section in the quest (core), issues are files in a quarantined `issues/`
  directory (Cloudflare-only for now), and reviews are git notes. The app's
  own databases only cache or hold secrets.
- Artifacts has no PR, merge, diff, or per-branch token API, and its push
  events don't identify the pusher. Contributors therefore each get their own
  fork with a fork-scoped token. The Worker is the only writer to upstream, and
  real git operations (diff, merge, notes) run in a Sandbox.
- Web login uses a pluggable auth layer: GitHub OAuth first, then Google and
  passkeys. ChatGPT web login and ChatGPT-funded hosted runs wait on OpenAI's
  hosted waitlist, because self-serve token sharing covers only local apps
  ([m1](/quest/m1/chatgpt-hosted.md)).
- Only the extra login providers may slip past the demo. GitHub sync, hosted
  runs, and issue intake must ship.
- Agents run either locally or hosted. Watching an agent run live is a
  non-goal beyond showing its status. In v1, checks run `quest check` only.

## Required

- [Core as wasm](/quest/m0/cloudflare/wasm.md) - the Worker runs the same parse, check, and ready rules as the CLI
- [Quest board](/quest/m0/cloudflare/board.md) - browse the tree and see what is ready, blocked, or claimed
- [Local runner](/quest/m0/cloudflare/run.md) - `quest run` claims a quest and runs Codex on the contributor's ChatGPT plan
- [Hosted runs](/quest/m0/cloudflare/hosted.md) - fund a quest with a stored API key and run OpenCode in a Sandbox
- [GitHub onboarding](/quest/m0/cloudflare/onboard.md) - enter a GitHub repository and get Quest set up through a PR
- [More logins](/quest/m0/cloudflare/logins.md) - Google and passkey sign-in
