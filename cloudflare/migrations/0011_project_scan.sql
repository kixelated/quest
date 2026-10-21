-- Scans split into history and occupancy passes. Observations are a cache, so
-- drop scans in the old shape; the next refresh starts both passes.
UPDATE github_project_state SET scan=NULL;
