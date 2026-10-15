-- Webhook inserts prune deliveries past the replay window by age.
CREATE INDEX github_deliveries_receivedAt ON github_deliveries(receivedAt);
