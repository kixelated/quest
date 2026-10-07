import type { Child } from "hono/jsx";

// The site shell: every HTML page the Worker serves renders inside Layout.
// Colours, type, and glyphs follow docs/theme.md; tokens live in /theme/theme.css.

export const repo = "https://github.com/kixelated/quest";

const fonts =
	"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=Inter:wght@400;600&display=swap";

export type User = { name: string };

export type Page = {
	// Omitted on the home page, which uses the full hook as its title.
	title?: string;
	description: string;
	origin: string;
	user: User | null;
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
								<form method="post" action="/sign-in">
									<button class="button quiet">Sign in with GitHub</button>
								</form>
							)}
						</span>
					</nav>
				</header>
				<main>{props.children}</main>
				<footer class="wrap site-footer">
					<Divider />
					<p>
						<a href="/">Quest</a> · <a href="/docs">Docs</a> · <a href={repo}>GitHub</a> · MIT or Apache-2.0
					</p>
				</footer>
			</body>
		</html>
	);
}

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

export type Size = "XS" | "S" | "M" | "L" | "XL";

// A size label in its difficulty colour, with the Elite tag on XL.
export function Difficulty(props: { size: Size }) {
	return (
		<>
			<span class={`ql-size ql-${props.size.toLowerCase()}`}>{props.size}</span>
			{props.size === "XL" && <span class="ql-elite">Elite</span>}
		</>
	);
}
