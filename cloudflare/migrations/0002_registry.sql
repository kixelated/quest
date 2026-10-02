-- Authorization records are application metadata. Quest/issue contents stay in Git.
CREATE TABLE repositories (
  name TEXT PRIMARY KEY NOT NULL,
  remote TEXT NOT NULL,
  defaultBranch TEXT NOT NULL CHECK(defaultBranch = 'main'),
  maintainerId TEXT NOT NULL REFERENCES user(id),
  createdAt INTEGER NOT NULL
);
CREATE TABLE forks (
  forkName TEXT PRIMARY KEY NOT NULL,
  repositoryName TEXT NOT NULL REFERENCES repositories(name),
  userId TEXT NOT NULL REFERENCES user(id),
  remote TEXT,
  provider TEXT NOT NULL,
  identity TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  lastPushAt INTEGER NOT NULL,
  UNIQUE(repositoryName, userId)
);
CREATE INDEX forks_repository ON forks(repositoryName);
