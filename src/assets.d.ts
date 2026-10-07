// The bundler inlines Markdown assets as text (esbuild's `text` loader, and a
// matching plugin in the test runner).
declare module "*.md" {
	const text: string;
	export default text;
}
