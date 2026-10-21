-- A webhook asks for a background read of its project. `requested` stays set
-- until a read starts, and `lease` (an expiry in ms) lets only one read run at
-- a time, so a burst of deliveries coalesces into one read. `failure` keeps the
-- last background read's error until a read or refresh succeeds.
ALTER TABLE github_project_state ADD COLUMN requested INTEGER NOT NULL DEFAULT 0 CHECK(requested IN (0,1));
ALTER TABLE github_project_state ADD COLUMN lease INTEGER;
ALTER TABLE github_project_state ADD COLUMN failure TEXT;
-- Counts the webhooks that named an entity since it was last read by number, so
-- a read clears only what it saw.
ALTER TABLE github_project_activity ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
UPDATE github_project_activity SET stale=1 WHERE data IS NULL AND missing=0;
