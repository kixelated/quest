import type { Child } from "hono/jsx";
import { raw } from "hono/html";

// The site shell: every HTML page the Worker serves renders inside Layout.
// Colours, type, and glyphs follow design/theme.md; tokens live in /theme/theme.css.

export const repo = "https://github.com/kixelated/quest";

const fonts =
	"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=Inter:wght@400;600&display=swap";

export type User = { name: string };

// A step in the breadcrumb trail; the last one is the current page.
export type Crumb = { label: string; href: string };

export type Page = {
	// Omitted on the home page, which uses the full hook as its title.
	title?: string;
	description: string;
	origin: string;
	// The current path, where signing in returns.
	path: string;
	user: User | null;
	crumbs?: Crumb[];
};

export function Layout(props: Page & { children: Child }) {
	const title = props.title ? `${props.title} · Quest` : "Quest: a quest log for your repo and your agents";
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{title}</title>
				<meta name="description" content={props.description} />
				<meta name="theme-color" content="#14100b" />
				<meta property="og:title" content={title} />
				<meta property="og:description" content={props.description} />
				<meta property="og:image" content={`${props.origin}/theme/og.png`} />
				<meta name="twitter:card" content="summary_large_image" />
				<link rel="icon" href="/theme/logo.svg" type="image/svg+xml" />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
				<link rel="stylesheet" href={fonts} />
				<link rel="stylesheet" href="/theme/theme.css" />
				<link rel="stylesheet" href="/site.css" />
			</head>
			<body>
				<header class="site-header">
					<nav class="wrap nav" aria-label="Site">
						<a class="brand" href="/">
							<img src="/theme/logo.svg" alt="" width="32" height="32" />
							Quest
						</a>
						<a href="/repos/quest">Quests</a>
						<a href="/docs">Docs</a>
						<a href={repo}>GitHub</a>
						<span class="account">
							{props.user ? (
								<>
									<span class="muted">Signed in as {props.user.name}.</span>
									<form method="post" action="/sign-out">
										<button class="button quiet">Sign out</button>
									</form>
								</>
							) : (
								<SignIn path={props.path}>Sign in with GitHub</SignIn>
							)}
						</span>
					</nav>
				</header>
				{props.crumbs && <Crumbs crumbs={props.crumbs} />}
				<main>{props.children}</main>
				<footer class="wrap site-footer">
					<Divider />
					<p>
						<a href="/">Quest</a> · <a href="/docs">Docs</a> · <a href={repo}>GitHub</a> · MIT or Apache-2.0
					</p>
				</footer>
				<script>{raw(copyScript)}</script>
			</body>
		</html>
	);
}

// Signing in returns to `path`.
export function SignIn(props: { path: string; primary?: boolean; children: Child }) {
	return (
		<form method="post" action="/sign-in">
			<input type="hidden" name="next" value={props.path} />
			<button class={`button ${props.primary ? "primary" : "quiet"}`}>{props.children}</button>
		</form>
	);
}

function Crumbs(props: { crumbs: Crumb[] }) {
	return (
		<nav class="wrap crumbs" aria-label="Breadcrumb">
			<ol>
				{props.crumbs.map((crumb, i) =>
					i === props.crumbs.length - 1 ? (
						<li aria-current="page">{crumb.label}</li>
					) : (
						<li>
							<a href={crumb.href}>{crumb.label}</a>
						</li>
					),
				)}
			</ol>
		</nav>
	);
}

// A line to paste, such as into an agent, with a copy button.
export function Paste(props: { id: string; text: string }) {
	return (
		<div class="paste-box">
			<code id={props.id}>{props.text}</code>
			<button class="button" type="button" data-copy={props.id} hidden>
				Copy
			</button>
		</div>
	);
}

// Progressive enhancement: reveal copy buttons only where the clipboard works.
const copyScript = `for (const button of document.querySelectorAll("[data-copy]")) {
	if (!navigator.clipboard) continue;
	button.hidden = false;
	button.addEventListener("click", async () => {
		await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
		button.textContent = "Copied";
		setTimeout(() => (button.textContent = "Copy"), 2000);
	});
}`;

// The ornamental divider: a gold rule broken by a lozenge between two dots.
export function Divider() {
	return (
		<div class="ql-divider" aria-hidden="true">
			<svg viewBox="0 0 48 16">
				<circle cx="6" cy="8" r="1.75" fill="currentColor" />
				<path d="M24 1 L31 8 L24 15 L17 8 Z" fill="currentColor" />
				<circle cx="42" cy="8" r="1.75" fill="currentColor" />
			</svg>
		</div>
	);
}

// Status glyphs, drawn like the mark. Colour comes from the marker class.
export function Bang() {
	return (
		<svg class="glyph" viewBox="-10 -22 20 44" aria-hidden="true">
			<g fill="currentColor" stroke="#1a1207" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke">
				<path d="M-6.5 -19 H6.5 L3 4 H-3 Z" />
				<path d="M0 8 L5.5 13.5 L0 19 L-5.5 13.5 Z" />
			</g>
		</svg>
	);
}

export function Query() {
	return (
		<svg class="glyph" viewBox="-12 -22 24 44" aria-hidden="true">
			<g stroke-linecap="round" stroke-linejoin="round">
				<path d="M-8 -9 C-8 -21 8 -21 8 -9 C8 -1 0 -1 0 5" fill="none" stroke="#1a1207" stroke-width="9.5" />
				<path d="M-8 -9 C-8 -21 8 -21 8 -9 C8 -1 0 -1 0 5" fill="none" stroke="currentColor" stroke-width="5" />
				<path
					d="M0 8 L5.5 13.5 L0 19 L-5.5 13.5 Z"
					fill="currentColor"
					stroke="#1a1207"
					stroke-width="2.4"
					paint-order="stroke"
				/>
			</g>
		</svg>
	);
}

// A gold coin: agent tokens, shown as gold. Display only.
export function Coin() {
	return (
		<svg class="glyph coin" viewBox="0 0 20 20" aria-hidden="true">
			<circle cx="10" cy="10" r="9" fill="#e6c063" stroke="#7a6230" stroke-width="1.5" />
			<circle cx="10" cy="10" r="5.5" fill="none" stroke="#a5741d" stroke-width="1" />
			<path d="M10 6.5 L13.5 10 L10 13.5 L6.5 10 Z" fill="#a5741d" />
		</svg>
	);
}

// A quest's status, per the glossary in design/theme.md.
export type Status = "available" | "blocked" | "accepted" | "turn-in";

// A status glyph: a yellow `!` for Available, a grey one for Requires, and a
// yellow `?` for Ready to turn in. Accepted has none. Always pair it with its label.
export function Marker(props: { status: Status }) {
	if (props.status === "accepted") return <span class="ql-marker" />;
	return <span class={`ql-marker ql-${props.status}`}>{props.status === "turn-in" ? <Query /> : <Bang />}</span>;
}

export type Size = "XS" | "S" | "M" | "L" | "XL";

// A size label in its size colour.
export function Difficulty(props: { size: Size }) {
	return <span class={`ql-size ql-${props.size.toLowerCase()}`}>{props.size}</span>;
}
