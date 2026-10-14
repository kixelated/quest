import { buildPagesASSETSBinding, cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Read deployed bindings locally. The Vitest plugin omits Workers assets,
// so use its file-backed ASSETS helper without contacting a Cloudflare account.
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: "./wrangler.jsonc" },
			remoteBindings: false,
			miniflare: {
				serviceBindings: { ASSETS: await buildPagesASSETSBinding("./build/public") },
				bindings: {
					AUTH_URL: "http://localhost:8787",
					AUTH_SECRET: "test-only-secret-that-is-at-least-32-characters",
					GITHUB_CLIENT_ID: "test-client-id",
					GITHUB_CLIENT_SECRET: "test-client-secret",
					TEST_MIGRATIONS: await readD1Migrations("./migrations"),
				},
			},
		})),
	],
	test: { setupFiles: ["./test/setup.ts"] },
});
