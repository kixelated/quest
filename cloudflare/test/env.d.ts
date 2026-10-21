declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
		// A test-only key, set in vitest.config.ts.
		VAPID_PRIVATE_KEY: string;
	}
}
