-- Activity reads that every board, inbox, and background read makes stay
-- proportional to open work, not to a repository's history. `readState` reads
-- only open entities and unread webhook pointers, in this index's order (its
-- WHERE term matches the index's exactly), and a background read takes the
-- entities webhooks named. The paged activity log, read only on its own page,
-- sorts the repository's rows, which retention bounds.
CREATE INDEX github_project_activity_live ON github_project_activity(repository,firstSeen,kind,id)
  WHERE (data IS NULL OR json_extract(data,'$.state')='OPEN');
CREATE INDEX github_project_activity_stale ON github_project_activity(repository,changedAt,id) WHERE stale>0;
