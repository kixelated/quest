-- A user's own machines. The token authenticates the machine to the job API
-- only; runners never receive GitHub credentials.
CREATE TABLE runners (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK(platform IN ('linux','darwin')),
  -- Can build an untrusted PR's devShell in a VM.
  vm INTEGER NOT NULL DEFAULT 0 CHECK(vm IN (0,1)),
  createdAt INTEGER NOT NULL,
  -- Last status over its live connection. Presence itself is the connection.
  seenAt INTEGER
);
CREATE INDEX runners_owner ON runners(owner);
-- Opaque references to agent logins held on a runner. Never tokens.
CREATE TABLE runner_accounts (
  runner TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('subscription','api-key')),
  label TEXT NOT NULL,
  -- The owner's preference order across all of their runners, lowest first.
  rank INTEGER NOT NULL,
  limited INTEGER NOT NULL DEFAULT 0 CHECK(limited IN (0,1)),
  PRIMARY KEY(runner,id)
);
-- One authorized unit of work. `attempt` fences runner writes: each claim
-- increments it, so a delayed or returning runner cannot write over its replacement.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  repository INTEGER NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  workflow TEXT NOT NULL CHECK(workflow IN ('plan','start','iterate','bootstrap')),
  target TEXT NOT NULL,
  revision TEXT NOT NULL,
  branch TEXT NOT NULL,
  actor TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  trusted INTEGER NOT NULL CHECK(trusted IN (0,1)),
  pinRunner TEXT,
  pinAccount TEXT,
  state TEXT NOT NULL CHECK(state IN ('queued','running','waiting','completed','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  runner TEXT,
  account TEXT,
  -- The agent session to resume on the same runner and account.
  session TEXT,
  -- While its runner is disconnected, when the running attempt moves.
  lease INTEGER,
  -- Whether the runner has listed the current attempt in a status; until
  -- then the hub resends the assignment.
  delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
  cancel INTEGER NOT NULL DEFAULT 0 CHECK(cancel IN (0,1)),
  summary TEXT,
  result TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- Duplicate requests for the same work find the active job instead.
CREATE UNIQUE INDEX jobs_active ON jobs(repository,target) WHERE state IN ('queued','running','waiting');
CREATE INDEX jobs_claimable ON jobs(actor,state,createdAt);
-- The job's progress record: claims, checkpoint summaries, cancellation, results.
CREATE TABLE job_events (
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('claimed','summary','cancel','result')),
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX job_events_job ON job_events(job);
-- At most one open question per attempt; an answer requeues the job.
CREATE TABLE job_questions (
  id TEXT PRIMARY KEY NOT NULL,
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('agent','account')),
  prompt TEXT NOT NULL,
  answer TEXT,
  answeredBy TEXT REFERENCES user(id) ON DELETE SET NULL,
  askedAt INTEGER NOT NULL,
  answeredAt INTEGER,
  UNIQUE(job,attempt)
);
-- Raw agent output, readable only by current project maintainers. The
-- runner numbers each attempt's chunks, so a retried chunk lands once.
CREATE TABLE job_output (
  job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(job,attempt,seq)
);
