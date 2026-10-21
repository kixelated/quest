-- Whose decision inbox lists a project: each user who passed a current
-- maintainer check on it, the enrolling user included. Membership is
-- navigation, never authority; every action still rechecks GitHub. A check
-- GitHub denies removes it, and disconnecting the project cascades.
-- `github_projects.enrolledBy` stays a record of who enrolled it.
CREATE TABLE github_project_members (
  repository INTEGER NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY(repository, user)
);
CREATE INDEX github_project_members_user ON github_project_members(user);
INSERT INTO github_project_members(repository, user) SELECT id, enrolledBy FROM github_projects;
