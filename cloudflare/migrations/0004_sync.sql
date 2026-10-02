CREATE TABLE github_pairs (
 repositoryName TEXT PRIMARY KEY REFERENCES repositories(name),
 githubRepositoryId INTEGER NOT NULL UNIQUE,
 installationId INTEGER NOT NULL,
 owner TEXT NOT NULL,
 name TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 subscriptionId TEXT
);
CREATE TABLE sync_refs (
 repositoryName TEXT NOT NULL REFERENCES github_pairs(repositoryName) ON DELETE CASCADE,
 ref TEXT NOT NULL,
 shared TEXT,
 leftHead TEXT,
 rightHead TEXT,
 status TEXT NOT NULL,
 updatedAt INTEGER NOT NULL,
 PRIMARY KEY(repositoryName,ref)
);
