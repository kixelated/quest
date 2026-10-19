-- Each maintainer's own view of a project's decision items, keyed by the job
-- target an item coalesces on (`issues/1`, `pulls/2`, a quest path, ...).
-- A version names what the item showed: a question, a GitHub change, a quest's
-- text. A newer version is unread again; a skip lasts until the item changes.
-- Read state is navigation only, never an answer or an approval.
CREATE TABLE inbox_items (
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  repository INTEGER NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  seen TEXT,
  skipped TEXT,
  PRIMARY KEY(user, repository, item)
);
