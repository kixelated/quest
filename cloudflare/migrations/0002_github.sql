-- Provider state is an authorization gate, never quest content or approval.
CREATE TABLE github_installations (
  id INTEGER PRIMARY KEY NOT NULL,
  blocked INTEGER NOT NULL CHECK (blocked IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL
);
-- Retain delivery IDs to reject replay; do not store untrusted issue/PR bodies.
CREATE TABLE github_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL,
  event TEXT NOT NULL,
  installation INTEGER,
  repository INTEGER,
  action TEXT,
  receivedAt INTEGER NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0, 1))
);
