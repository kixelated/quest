import { parse } from "jsonc-parser";
import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Artifacts is remote-only, including Wrangler local mode. Build local test
// bindings from the deploy config without Artifacts so CI never authenticates
// or connects to a Cloudflare account. No repository operations exist yet.
const config = parse(readFileSync("./wrangler.jsonc", "utf8"));
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			main: config.main,
			remoteBindings: false,
			miniflare: {
				modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm", "**/*.wasm?module"] }],
				compatibilityDate: config.compatibility_date,
				compatibilityFlags: config.compatibility_flags,
				d1Databases: config.d1_databases.map((db: { binding: string }) => db.binding),
				durableObjects: Object.fromEntries(
					config.durable_objects.bindings.map((binding: { name: string; class_name: string }) => [
						binding.name,
						{ className: binding.class_name, useSQLite: true },
					]),
				),
				bindings: {
					...config.vars,
					AUTH_SECRET: "test-only-secret-that-is-at-least-32-characters",
					GITHUB_CLIENT_ID: "test-client-id",
					GITHUB_CLIENT_SECRET: "test-client-secret",
					TEST_MIGRATIONS: await readD1Migrations("./migrations"),
				},
			},
		})),
	],
	test: { setupFiles: ["./test/setup.ts"], exclude: ["**/*.node.test.ts", "**/node_modules/**"] },
});
