-- Better Auth passkey plugin schema. Public keys only; private keys stay on the authenticator.
CREATE TABLE passkey (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL UNIQUE,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt INTEGER,
  aaguid TEXT
);
CREATE INDEX passkey_userId ON passkey(userId);
-- A provider identity belongs to one user, and a user links at most one
-- account per provider, so the GitHub identity behind repository authority is unambiguous.
CREATE UNIQUE INDEX account_provider_identity ON account(providerId, accountId);
CREATE UNIQUE INDEX account_user_provider ON account(userId, providerId);
