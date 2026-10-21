-- Web Push subscriptions, one per browser or installed app. The endpoint
-- names the device's push channel and moves to whoever enables
-- notifications on it last. Signing out deletes the subscriptions that
-- session enabled, and a push service reporting one gone deletes it.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY NOT NULL,
  user TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- The session that enabled it; not a foreign key, so an expired session
  -- keeps notifying until its device signs out.
  session TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session);
