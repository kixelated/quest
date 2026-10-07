import { defineConfig } from "vitest/config";

// The CLI bundles Markdown assets as text (esbuild's `text` loader); load them
// the same way here.
export default defineConfig({
	plugins: [
		{
			name: "markdown-text",
			transform(code, id) {
				if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
			},
		},
	],
	test: { include: ["test/**/*.test.ts"] },
});
