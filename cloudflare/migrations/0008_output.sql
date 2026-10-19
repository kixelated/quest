-- Raw agent output moves to R2, one object per chunk at
-- output/<job>/<attempt>/<seq>. Nothing is deployed yet, so the D1 text is
-- dropped rather than copied.
DROP TABLE job_output;
-- Each attempt's output totals. It lives as long as the job, so expiring
-- chunks never give capacity back and an expired `seq` is never reused.
CREATE TABLE job_output_attempts (
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  runner TEXT NOT NULL,
  -- The only `seq` the attempt accepts next; also its count of chunks.
  next INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  -- Set once a chunk is refused for the attempt's cap; later chunks are too.
  truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
  PRIMARY KEY(job,attempt)
);
-- The index of stored chunks, readable only by current project maintainers.
-- A row reserves its `seq` for one text, by hash, before the object is
-- written; `complete` marks the object written. The daily cron deletes rows
-- older than the bucket's 30-day lifecycle.
CREATE TABLE job_output (
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  hash TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
  at INTEGER NOT NULL,
  PRIMARY KEY(job,attempt,seq)
);
CREATE INDEX job_output_at ON job_output(at);
-- Jobs whose output objects a disconnect still has to delete. Written in the
-- same batch that deletes the project, and retried by the daily cron.
CREATE TABLE output_cleanup (
  job TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL
);
