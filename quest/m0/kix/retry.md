# [XS] Continue a retried job from its published branch

## Goal

"Try again" on a failed plan, bootstrap, or start job that already
published to its branch continues from that branch's last published head.
The retry publishes normally, and nobody deletes the branch by hand.

## Plan

Decided 2026-10-19 as a follow-up of the decision inbox (#144), whose final
Codex review found that a retry starts with `head` unset, so its first
publication pauses with "already has the branch … Delete it on GitHub to
start over" (`cloudflare/src/jobs/publish.ts`):

- The retry records the failed job's last published `head` and continues on
  the same branch, the way a reassigned job resumes from its checkpoint. The
  existing fence and head checks still apply.
- A branch that changed outside kix since that head still pauses on the
  existing decision; only a branch at the recorded head continues.
- Test a retry after a published checkpoint, a retry with nothing
  published, and a branch moved outside kix.
