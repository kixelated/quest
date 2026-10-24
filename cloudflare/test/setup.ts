import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// Every test starts from empty, freshly migrated storage, so none depends on
// rows, objects, or Durable Objects another test left behind.
beforeEach(async () => {
	await reset();
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
