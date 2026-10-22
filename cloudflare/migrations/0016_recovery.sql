-- The failed job a retry continues. A retry's decision record follows this
-- chain, so answers survive a failure that opened no pull request.
ALTER TABLE jobs ADD COLUMN continues TEXT REFERENCES jobs(id) ON DELETE SET NULL;
