# [M] Run maintainers' PR heads on any runner

## Goal

kix classifies a PR head whose commits all come from the project's
maintainers or kix jobs as trusted, so its iterate and merge jobs run on any
runner, in the same sandbox as other trusted revisions. Any other PR head is
untrusted and routes only to Linux runners that register with `vm: true`.

## Plan

- Decided 2026-10-15 (from Codex's review of kixelated/quest#121): job
  coordination marks every `iterate` job untrusted and routes it only to
  Linux runners with `vm: true`, unless every commit on the head comes from a
  maintainer or a kix job.
- Classify by authenticated provenance, never by commit authorship: GitHub
  links a commit to an account by its author email, which a contributor can
  forge (from Codex's review of
  [kixelated/quest#220](https://github.com/kixelated/quest/pull/220)). A
  commit comes from a maintainer only when GitHub reports its signature
  verified for that maintainer's account, and from a kix job only when kix
  recorded that job pushing it. Any other commit, including a maintainer's
  unsigned one, makes the head untrusted.
- Check against the project's current maintainers when the job is created
  and again when it is assigned, so a head that gains a contributor's commit
  is reclassified.
- The runner keeps refusing untrusted jobs until
  [untrusted devShells](/quest/m0/kix/sandbox/vm.md) ship, so until then an
  untrusted head's job waits with "needs a Linux runner".
- Test a maintainer-only head, a head with one contributor commit, a head
  that gains one after the job is queued, a revoked maintainer's commit, an
  unsigned maintainer commit, and a contributor commit forging a
  maintainer's author email.
