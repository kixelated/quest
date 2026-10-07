# Quest on Cloudflare

## Goal

Maintainers scope quests and chapters in a repository hosted on Cloudflare
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
  importing the shared TypeScript core. The Nix shell gains node and wrangler, and CI
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
  ([c1](/quest/c1/chatgpt-hosted.md)).
- Only the extra login providers may slip past the demo. GitHub sync, hosted
  runs, and issue intake must ship.
- Production lives at `https://kixel.quest` (bought 2026-10-05 on Porkbun),
  a Workers custom domain, so its DNS moves to Cloudflare before deploying.
- Quest moves from Rust to TypeScript (decided 2026-10-06): one language and
  one core for the CLI, Worker, site, and map, replacing the wasm bridge.
  The port landed on this epic's branch, which then folded into main
  (#35, decided 2026-10-07). Remaining children target main, per #44.
- Agents run either locally or hosted. Watching an agent run live is a
  non-goal beyond showing its status. In v1, checks run `quest check` only.

## Required

- [Fork intake](/quest/c0/cloudflare/intake.md) - contributor forks, the push gate, and claims and issues pulled into main
- [Changes](/quest/c0/cloudflare/changes.md) - review and merge fork branches with diffs, git-note reviews, and checks
- [Quest board](/quest/c0/cloudflare/board.md) - browse the tree and see what is ready, blocked, or claimed
- [Local runner](/quest/c0/cloudflare/run.md) - `quest run` claims a quest and runs Codex on the contributor's ChatGPT plan
- [Hosted runs](/quest/c0/cloudflare/hosted.md) - fund a quest with a stored API key and run OpenCode in a Sandbox
- [GitHub sync](/quest/c0/cloudflare/github-sync.md) - two-way fast-forward sync of main, quest branches, and notes
- [GitHub onboarding](/quest/c0/cloudflare/onboard.md) - enter a GitHub repository and get Quest set up through a PR
- [More logins](/quest/c0/cloudflare/logins.md) - Google and passkey sign-in
- [Quest log theme](/quest/c0/theme/README.md) - the demo is recorded after the themed board, landing page, and README land
