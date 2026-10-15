// Markdown assets import as text (Bun's `text` loader in bunfig.toml, and a
// matching plugin in the test runner).
declare module "*.md" {
	const text: string;
	export default text;
}
