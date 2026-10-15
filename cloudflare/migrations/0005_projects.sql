-- Installing the App never enrolls a project. Only an authenticated current
-- maintainer's explicit opt-in creates this record. Provider gates stay separate.
CREATE TABLE github_projects (
  id INTEGER PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  installation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('enabled', 'paused')),
  enrolledBy TEXT NOT NULL REFERENCES user(id),
  updatedAt INTEGER NOT NULL
);
CREATE INDEX github_projects_maintainer ON github_projects(enrolledBy);
