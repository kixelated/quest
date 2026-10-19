-- The commit the job's branch holds, as far as kix has published or observed
-- it. NULL until the first publication creates the branch; an iteration starts
-- at the pull request's head.
ALTER TABLE jobs ADD COLUMN head TEXT;
-- A commit whose branch update is in flight. If the Worker stops before
-- recording the outcome, the next publication finds it on the branch and
-- adopts it instead of treating it as someone else's write.
ALTER TABLE jobs ADD COLUMN pending TEXT;
ALTER TABLE jobs ADD COLUMN pendingAt INTEGER;
-- The pull request this job delivered, which later deliveries update.
ALTER TABLE jobs ADD COLUMN pull INTEGER;
-- Publication decisions are service-authored, unlike agent questions. SQLite
-- cannot alter a CHECK constraint, so rebuild the table.
CREATE TABLE job_questions_new (
  id TEXT PRIMARY KEY NOT NULL,
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('agent','account','publication')),
  prompt TEXT NOT NULL,
  answer TEXT,
  answeredBy TEXT REFERENCES user(id) ON DELETE SET NULL,
  askedAt INTEGER NOT NULL,
  answeredAt INTEGER,
  UNIQUE(job,attempt)
);
INSERT INTO job_questions_new SELECT id,job,attempt,kind,prompt,answer,answeredBy,askedAt,answeredAt FROM job_questions;
DROP TABLE job_questions;
ALTER TABLE job_questions_new RENAME TO job_questions;
