CREATE TABLE changes (
  repositoryName TEXT NOT NULL REFERENCES repositories(name),
  forkName TEXT NOT NULL REFERENCES forks(forkName),
  branch TEXT NOT NULL,
  head TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (repositoryName, forkName, branch)
);
