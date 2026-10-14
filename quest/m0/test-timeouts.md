# [M] Make local Worker tests reliable under load

## Goal

`just test` passes the Cloudflare Worker suite on a busy development host
without raising the 5-second test timeout, retrying, or skipping tests. CI
already passes the suite in about 13 seconds. Locally, every agent on
2026-10-14 saw 12 to 16 Worker tests time out while other sessions kept the
load average at 34 to 43 on 24 cores.

## Plan

- Find the root cause before changing anything. Likely candidates include
  how many workerd isolates the vitest pool starts in parallel, per-file
  workerd/miniflare startup, D1 migrations repeated in each test's setup, and
  tests that do real work (key generation, signing) on the hot path. Measure
  where the time goes on a loaded host and compare it with an idle one.
- Prefer fixes that make tests do less work, or fixes that size the pool to
  the host, over anything that only hides latency.
- Reproduce with background load (for example, a parallel CPU burner) so the
  fix can be checked without waiting for a busy machine.
- Decided 2026-10-14: this ranks first in m0 because it slows every agent run
  and buries real failures in timeout noise.
