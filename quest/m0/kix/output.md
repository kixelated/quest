# [M] Retain raw agent output in R2

## Goal

Raw agent output that runners upload is stored in R2 instead of D1, and kept
for 30 days with at most 64 MiB per attempt. When an attempt reaches the cap,
later chunks are refused with a `truncated` marker, while the job keeps running
and its summaries stay intact. The maintainer-only output endpoint keeps paging
by `(attempt, seq)`. D1 holds only a small index. Expired output, and the output
of disconnected projects, is deleted without operator action.

## Plan

Decided 2026-10-17 in the planning interview, as a follow-up of the merged
job-coordination PR (#135), which stored output text in D1 `job_output` rows
with no total cap:

- m0, before [agent activity](/quest/m0/kix/activity.md), so launch does not
  ship unbounded transcripts in D1.
- Store one R2 object per chunk at `output/<job>/<attempt>/<seq>`. A D1 index
  row per chunk keeps paging and retry idempotency (same `seq` and text succeeds; a different chunk with the same
  `seq` is refused). Objects are crash-safe and readable while a job runs.
- Cap: 64 MiB of UTF-8 per attempt, and a bound on chunks per attempt so many
  tiny chunks cannot multiply rows and objects before the byte cap is reached.
  Once either is reached, refuse further chunks with `truncated`, record the
  truncation once so the disclosure shows it, and never fail the job.
- Keep a compact per-attempt record (bytes and chunks accepted, highest `seq`,
  truncated) that outlives the expiring index rows while the attempt can still
  send output. Expiry then cannot give capacity back, and a replayed `seq` at
  or below the highest accepted one is only accepted as an idempotent retry
  while its row remains, and refused after that.
- Retention: a bucket lifecycle rule deletes `output/` objects 30 days after
  upload, and a daily Worker cron deletes their index rows. The clock runs from
  each chunk's upload. Reads ignore an index row whose object is already gone.
- Disconnecting a project deletes its jobs' output objects immediately, along
  with the job records it already deletes. R2 cannot join the D1 batch, so
  reserve each chunk first: insert its index row with the text's hash, only
  while the job exists and the `seq` is unused or holds the same hash. A
  conflicting chunk is refused before anything reaches R2, so it can never
  overwrite accepted output. Then write the object and mark the row complete;
  if the row is gone by then, delete the object just written. Disconnect
  deletes each job's `output/<job>/` prefix after its D1 delete commits, so an
  upload racing it is removed by one side or the other.
- No data migration: kix.quest is not deployed yet
  ([deploy](/quest/m0/kix/deploy.md)), so replace `job_output.text` rather
  than copying existing rows.
- Keep every read behind the existing per-request maintainer check, and test
  that other users and revoked maintainers are refused.
- Documentation stays inline: update `cloudflare/README.md` (bucket binding,
  lifecycle rule, cron, cap) and the runner protocol notes in the same change.

## Related

- [Runner](/quest/m0/kix/runner.md) - uploads the raw output this stores
