import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Use the deploy config's bindings locally; tests never contact a Cloudflare account.
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: "./wrangler.jsonc" },
			remoteBindings: false,
			miniflare: {
				bindings: {
					AUTH_URL: "http://localhost:8787",
					AUTH_SECRET: "test-only-secret-that-is-at-least-32-characters",
					GITHUB_CLIENT_ID: "test-client-id",
					GITHUB_CLIENT_SECRET: "test-client-secret",
					GITHUB_APP_ID: "123",
					GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
					GITHUB_APP_PRIVATE_KEY: "test-key-injected-by-service-tests",
					GITHUB_FORK_OWNER: "quest-bot-forks",
					TEST_MIGRATIONS: await readD1Migrations("./migrations"),
				},
			},
		})),
	],
	// Each test file otherwise starts its own workerd and re-imports the whole Worker
	// (the pool appends `import main` to cloudflare:test), all transformed by vitest's
	// one Node process, which also answers a module resolve for every SELF.fetch.
	// One shared runtime imports the Worker once, so a busy host can't stall the tests.
	test: { setupFiles: ["./test/setup.ts"], fileParallelism: false, isolate: false },
});
