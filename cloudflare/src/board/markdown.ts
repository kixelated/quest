// A quest's Markdown, rendered for its page. Quests can arrive from
// contributors' forks, so raw HTML shows as text, images as their alt text,
// and only web and mail links survive. Links into the tree open board pages.

import { Marked, type Token } from "marked";
import { normalize } from "quest/core";
import { blobHref, questHref } from "./model";
import type { Project } from "./project";

export type Section = { heading: string; html: string };

function escape(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Where a link in `from` should point on the site, or `null` to drop it and
 * keep its text. Relative links resolve the way GitHub resolves them.
 */
export function rewrite(project: Project, from: string, href: string, known: (path: string) => boolean): string | null {
	if (/^(https?|mailto):/i.test(href)) return href;
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
	if (href.startsWith("#")) return href;
	const [path, hash = ""] = href.split(/(?=#)/);
	const target = normalize(path.startsWith("/") ? path.slice(1) : `${from.slice(0, from.lastIndexOf("/"))}/${path}`);
	if (target === "" || target.startsWith("..")) return null;
	if (known(target)) return questHref(project, target) + hash;
	return blobHref(project, target, hash);
}

/** The document's `## ` sections in order, each rendered to HTML. The `# ` title is left to the page. */
export function render(project: Project, path: string, content: string, known: (path: string) => boolean): Section[] {
	const marked = new Marked({
		gfm: true,
		renderer: {
			html: ({ text }) => escape(text),
			image: ({ text }) => escape(text),
			// After an inline `<code>`, `<pre>`, or `<script>` tag, marked marks the
			// following text as raw and passes it through unescaped. Raw HTML never
			// renders here, so that text is escaped like any other.
			text: (token) => ("escaped" in token && token.escaped ? escape(token.text) : false),
			link({ href, tokens }) {
				const inner = this.parser.parseInline(tokens);
				const target = rewrite(project, path, href, known);
				return target === null ? inner : `<a href="${escape(target)}">${inner}</a>`;
			},
			// Section headings belong to the page; deeper ones step down below them.
			heading({ tokens, depth }) {
				const level = Math.min(depth + 1, 6);
				return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
			},
		},
	});
	const sections: { heading: string; tokens: Token[] }[] = [];
	for (const token of marked.lexer(content)) {
		if (token.type === "heading" && token.depth === 1) continue;
		if (token.type === "heading" && token.depth === 2) {
			sections.push({ heading: token.text.trim(), tokens: [] });
		} else if (sections.length > 0) {
			sections.at(-1)!.tokens.push(token);
		} else if (token.type !== "space") {
			sections.push({ heading: "", tokens: [token] });
		}
	}
	return sections.map(({ heading, tokens }) => ({ heading, html: marked.parser(tokens) }));
}
