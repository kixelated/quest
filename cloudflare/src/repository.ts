import { DurableObject } from "cloudflare:workers";

// Unbound legacy class retained to preserve deployed storage and migration history.
// Remove only after the operator verifies and approves permanent storage cleanup.
export class RepositoryCoordinator extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO metadata VALUES (1, 1);
    `);
	}

	status() {
		const row = this.ctx.storage.sql
			.exec<{ schema_version: number }>("SELECT schema_version FROM metadata WHERE id = 1")
			.one();
		return { schemaVersion: row.schema_version };
	}
}
