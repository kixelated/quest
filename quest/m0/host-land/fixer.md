# [M] Fix ejected batches with Codex

## Goal

When the host gate ejects a batch, it starts `codex exec` on the batch in the
background and keeps landing other work. Codex reads the failure, requeues
every PR it finds healthy unchanged, makes mechanical fixes to the rest and
requeues them, and hands back anything else. Each ejection gets one attempt.

## Plan

Decided 2026-10-30 (user, /quest-plan); see the
[epic](/quest/m0/host-land/README.md).

- **Mechanical only.** A fix may not change behavior: resolving a conflict
  while keeping both sides' intent, formatting and lint fixes, regenerating
  lockfiles or generated files, following a rename the base made, or
  requeueing unchanged after a flaky failure. Codex adds a line to the PR's
  `## Review` record, `mechanical fix by Codex: <reason>`, naming the new
  head, and requeues with `quest merge --land`.
- **Guide.** Add that exemption to the guide's Reviews section beside the
  conflict-free base merge and the reviewer's patch. Anything that would
  need a review is not mechanical.
- **Hand back.** Anything else, or a PR ejected again after its one attempt,
  stays unqueued with a comment giving Codex's diagnosis and a
  recommendation. `/quest-complete` asks about it again, recommending
  `/quest-iterate`. Count the attempt from the ejection comments since the
  maintainer's last pick.
- A flaky failure the fixer requeues becomes a suggested follow-up in its
  comment.
- Codex runs with the maintainer's own Codex login and a write credential
  for pushing to the PR branch and requeueing, never the bot key.

## Required

- [Host daemon](/quest/m0/host-land/daemon.md) - ejects batches and starts the fixer
