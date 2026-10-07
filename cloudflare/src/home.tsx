import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { Bang, Coin, Difficulty, Divider, Query, repo, type Size } from "./layout";

// The home page. Display names follow the glossary in docs/theme.md.

type Status = "available" | "blocked" | "accepted" | "turn-in";

const log: { status: Status; label: string; size: Size; title: string }[] = [
	{ status: "turn-in", label: "Ready to turn in", size: "S", title: "Add the CSV endpoint" },
	{ status: "blocked", label: "Requires: CSV endpoint", size: "M", title: "Add a CSV download button" },
	{ status: "available", label: "Available", size: "XS", title: "Document the export format" },
	{ status: "accepted", label: "Accepted by @jdoe", size: "XL", title: "Stream exports for large accounts" },
];

const sample = `# [M] Add a CSV download button

## Goal

People can download their data as a CSV from
the settings page.

## Plan

Call the export endpoint. Show progress, and let
people retry a failed download.

## Required

- [CSV endpoint](/quest/c0/export.md) - the
  button needs something to call

## Closes

- [#42](https://github.com/acme/app/issues/42)
`;

const tree = `quest/
  README.md      # The roadmap
  c0/
    README.md    # First chapter, in priority order
    export.md    # Available
    download.md  # Requires: export.md`;

function Marker(props: { status: Status }) {
	if (props.status === "accepted") return <span class="ql-marker marker-empty" />;
	return <span class={`ql-marker ql-${props.status}`}>{props.status === "turn-in" ? <Query /> : <Bang />}</span>;
}

function Section(props: { id: string; title: string; children: Child }) {
	return (
		<section class="wrap section" id={props.id} aria-labelledby={`${props.id}-title`}>
			<Divider />
			<h2 id={`${props.id}-title`}>{props.title}</h2>
			{props.children}
		</section>
	);
}

export function Home(props: { setup: string }) {
	const paste = `Follow ${props.setup} to set up Quest here.`;
	return (
		<>
			<section class="wrap hero">
				<div class="hero-copy">
					<h1>A quest log for your repo and your agents</h1>
					<p class="lede">Readable plans. Explicit dependencies. Reviewable Git changes.</p>
					<p>
						Quest keeps your plans as Markdown files in your repository, so you and your agents read,
						accept, and finish the same work.
					</p>
					<div class="paste">
						<p class="paste-label">Paste this into Claude Code or Codex:</p>
						<div class="paste-box">
							<code id="paste">{paste}</code>
							<button class="button" type="button" data-copy="paste" hidden>
								Copy
							</button>
						</div>
					</div>
					<p class="actions">
						<a class="button primary" href="/docs/getting-started">
							Get started
						</a>
						<a class="button quiet" href={repo}>
							View on GitHub
						</a>
					</p>
				</div>
				<div class="ql-ledger hero-log" aria-label="An example quest log">
					<h2 class="log-title">Quest log</h2>
					<ul class="log">
						{log.map((entry) => (
							<li class="entry">
								<Marker status={entry.status} />
								<span class="entry-title">{entry.title}</span>
								<span class="entry-meta">
									<Difficulty size={entry.size} />
									<span
										class={`entry-status ${entry.status === "accepted" ? "muted" : `ql-${entry.status}`}`}
									>
										{entry.label}
									</span>
								</span>
							</li>
						))}
					</ul>
				</div>
			</section>

			<Section id="files" title="Every plan is a file">
				<div class="split">
					<div>
						<p>
							A quest is a Markdown file scoped to one pull request: its objectives, what has been
							decided, and what stands in the way. Epics are folders, and chapters group them by horizon.
						</p>
						<p>
							Any agent that can read your repository can find the work. No database, no tracker to sync,
							and <code>quest check</code> keeps every link and dependency honest.
						</p>
					</div>
					<figure class="ql-ledger code-page">
						<figcaption>Your repository</figcaption>
						<pre>
							<code>{tree}</code>
						</pre>
					</figure>
				</div>
			</Section>

			<Section id="git" title="Coordinate agents through Git">
				<p class="intro">
					No server holds the plan. Agents coordinate the way your team already does: with branches and pull
					requests.
				</p>
				<ol class="lifecycle">
					<li>
						<p class="state ql-available">
							<span class="ql-marker">
								<Bang />
							</span>
							Available
						</p>
						<p>
							<code>quest ready</code> lists the quests with nothing standing in their way.
						</p>
					</li>
					<li>
						<p class="state">Accepted by @agent</p>
						<p>Pushing a quest's branch claims it, so the next agent picks something else.</p>
					</li>
					<li>
						<p class="state ql-turn-in">
							<span class="ql-marker">
								<Query />
							</span>
							Ready to turn in
						</p>
						<p>The work arrives as a draft pull request, plan and code reviewed together.</p>
					</li>
					<li>
						<p class="state">Quest complete</p>
						<p>Merging deletes the plan, Git keeps its history, and the next quest becomes available.</p>
					</li>
				</ol>
			</Section>

			<Section id="sample" title="As written, as read">
				<p class="intro">The same quest: the Markdown your agents edit, and the page you read.</p>
				<div class="split sample">
					<figure class="ql-ledger code-page">
						<figcaption>quest/c0/download.md</figcaption>
						<pre>
							<code>{sample}</code>
						</pre>
					</figure>
					<article class="ql-ledger quest-page" aria-label="The quest, rendered">
						<header class="quest-head">
							<span class="ql-marker ql-blocked">
								<Bang />
							</span>
							<h3>Add a CSV download button</h3>
							<Difficulty size="M" />
						</header>
						<p class="quest-status ql-blocked">Requires: CSV endpoint</p>
						<h4>Objectives</h4>
						<p class="ql-dropcap">People can download their data as a CSV from the settings page.</p>
						<h4>Plan</h4>
						<p>Call the export endpoint. Show progress, and let people retry a failed download.</p>
						<h4>Requires</h4>
						<ul>
							<li>CSV endpoint: the button needs something to call</li>
						</ul>
						<h4>Rewards</h4>
						<ul>
							<li>Closes #42</li>
						</ul>
					</article>
				</div>
			</Section>

			<Section id="how" title="How it works">
				<ol class="steps">
					<li>
						<h3>Plan with your agent</h3>
						<p>
							<code>/quest-plan</code> asks the questions that turn an idea into scoped quests, with
							dependencies, in priority order.
						</p>
					</li>
					<li>
						<h3>Send out the party</h3>
						<p>
							<code>/quest-start</code> takes one quest to a pull request. <code>/quest-spawn</code> sends
							several agents out in parallel.
						</p>
					</li>
					<li>
						<h3>Review and merge</h3>
						<p>
							You review every change. <code>/quest-merge</code> lands it once checks and reviews pass,
							and the next quest becomes available.
						</p>
					</li>
				</ol>
				<p class="note">
					In Codex, use <code>$quest-plan</code> and friends. The binary carries the skills, so your
					repository pins one version.
				</p>
			</Section>

			<Section id="map" title="Long-term plans, as a map">
				<div class="ql-ledger map-placeholder">
					<svg class="map-route" viewBox="0 0 600 120" aria-hidden="true">
						<path
							d="M20 90 C110 20 170 110 260 60 S420 10 480 70 S560 100 580 40"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-dasharray="6 8"
						/>
						{[
							[20, 90],
							[260, 60],
							[480, 70],
							[580, 40],
						].map(([x, y]) => (
							<path
								d={`M${x} ${y - 9} L${x + 9} ${y} L${x} ${y + 9} L${x - 9} ${y} Z`}
								fill="currentColor"
							/>
						))}
					</svg>
					<p>
						Chapters become regions, epics become roads, and every quest is a waypoint marked with its
						status. The map of Quest's own plans is still being charted. Until then, read{" "}
						<a href={`${repo}/blob/main/quest/c0/README.md`}>the first chapter</a> on GitHub.
					</p>
				</div>
			</Section>

			<Section id="party" title="Join the party">
				<div class="split">
					<div>
						<p>
							Quest is open source, and it is planned in the open with Quest itself. Contributors accept
							quests from the same log your agents read.
						</p>
						<p>
							Soon you will be able to <span class="ql-gold">offer gold</span>, your agent's tokens, to
							fund a quest you want finished. Gold is how the log shows tokens: there is no XP and no
							leaderboard.
						</p>
					</div>
					<div class="ql-ledger offer">
						<p class="offer-amount">
							<Coin />
							<span class="ql-gold">Offer gold</span>
						</p>
						<p class="muted">
							Arrives with the quest board. Until then, pick an available quest and send your agent to
							finish it.
						</p>
						<p class="actions">
							<a class="button primary" href={`${repo}/tree/main/quest`}>
								Browse the quests
							</a>
							<a class="button quiet" href={`${repo}/blob/main/CONTRIBUTING.md`}>
								Contributing
							</a>
						</p>
					</div>
				</div>
			</Section>

			<script>{raw(copyScript)}</script>
		</>
	);
}

// Progressive enhancement: reveal the copy button only where the clipboard works.
const copyScript = `for (const button of document.querySelectorAll("[data-copy]")) {
	if (!navigator.clipboard) continue;
	button.hidden = false;
	button.addEventListener("click", async () => {
		await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
		button.textContent = "Copied";
		setTimeout(() => (button.textContent = "Copy"), 2000);
	});
}`;
