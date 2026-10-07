import { raw } from "hono/html";
// Rendered from the repository's docs/*.md by scripts/build.ts.
import docs from "../build/docs.json";
import { repo } from "./layout";

export type Doc = (typeof docs)[number];

export function findDoc(slug: string): Doc | undefined {
	return docs.find((doc) => doc.slug === slug);
}

export function DocIndex() {
	return (
		<section class="wrap docs">
			<h1>Docs</h1>
			<ul class="doc-list">
				{docs.map((doc) => (
					<li>
						<a class="ql-ledger doc-card" href={`/docs/${doc.slug}`}>
							<span class="doc-title">{doc.title}</span>
							<span class="muted">{doc.summary}</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

export function DocPage(props: { doc: Doc }) {
	return (
		<section class="wrap docs">
			<nav class="doc-nav" aria-label="Docs">
				<a href="/docs">All docs</a>
				<a href={`${repo}/blob/main/docs/${props.doc.slug}.md`}>Edit on GitHub</a>
			</nav>
			<article class="ql-ledger prose">{raw(props.doc.html)}</article>
		</section>
	);
}
