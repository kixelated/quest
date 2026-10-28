-- Authenticated publication provenance, recorded only after a branch update succeeds.
CREATE TABLE job_commits (
 repository INTEGER NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
 sha TEXT NOT NULL,
 job TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 PRIMARY KEY(repository,sha)
);
