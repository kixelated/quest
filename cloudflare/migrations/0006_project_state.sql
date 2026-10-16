-- Cached observations never grant authority. Disconnect removes their retention.
CREATE TABLE github_project_state (
  repository INTEGER PRIMARY KEY REFERENCES github_projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  epoch TEXT NOT NULL,
  invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
  snapshot TEXT,
  scan TEXT,
  observedAt INTEGER
);
-- One durable notification per provider entity, independent of delivery IDs.
-- Webhooks keep only identity pointers; authenticated reconciliation fills data.
CREATE TABLE github_project_activity (
  repository INTEGER NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('issue','pull')),
  id TEXT NOT NULL,
  number INTEGER NOT NULL,
  firstSeen INTEGER NOT NULL,
  changedAt INTEGER NOT NULL,
  data TEXT,
  seenIn TEXT,
  missing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(repository,kind,id)
);
