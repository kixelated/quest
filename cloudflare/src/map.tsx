import { type Doc, entries, rooted } from "quest/core";
import { type Act, type Board, type Progress, type Quest, type Status, actAnchor, flatten } from "./board/model";
import { Difficulty } from "./layout";

// The home page's quest map: the project's own tree, read left to right like
// a world map. Acts are regions, epics are paths, and quests are waypoints
// coloured by size. Statuses use the format's own terms, with no display
// aliases (decided 2026-10-07 on kixelated/quest#78).

/** A quest on the map and where its waypoint leads. */
export type Waypoint = { quest: Quest; href: string };

/** One path through a region: an epic, or the quests an act lists directly. */
export type Path = { title: string; href: string | null; progress: Progress | null; waypoints: Waypoint[] };

export type Region = { act: Act; href: string; paths: Path[] };

/**
 * How far along its path a quest sits: 0 with nothing in the tree before it,
 * otherwise one past the furthest quest it requires. A required epic counts
 * as everything it still holds.
 */
function steps(docs: Map<string, Doc>): (path: string) => number {
	const memo = new Map<string, number>();
	const step = (path: string): number => {
		const known = memo.get(path);
		if (known !== undefined) return known;
		// A cycle is a `quest check` failure; it must not hang the page.
		memo.set(path, 0);
		const required = entries(docs.get(path)!, "Required")
			.map((entry) => (entry.target === null ? null : rooted(entry.target)))
			.filter((target): target is string => target !== null && docs.has(target));
		const value = required.length === 0 ? 0 : 1 + Math.max(...required.map(step));
		memo.set(path, value);
		return value;
	};
	return step;
}

/** The board's acts as map regions, each path ordered by step, then priority. */
export function chart(board: Board): Region[] {
	const { project } = board;
	// Until the landing page (quest/a0/theme/landing.md) links waypoints to the
	// board, they open the files on GitHub.
	const file = (path: string) => (project.web ? `${project.web}/blob/main/${path}` : null);
	const step = steps(board.docs);
	const ordered = (quests: Quest[]): Waypoint[] =>
		quests
			.map((quest, rank) => ({ quest, rank, step: step(quest.path) }))
			.sort((a, b) => a.step - b.step || a.rank - b.rank)
			.map(({ quest }) => ({ quest, href: file(quest.path) ?? quest.href }));

	return board.acts.map((act) => {
		// Paths keep the act's priority order. The quests it lists directly share
		// one main path, placed where the first of them is listed.
		const loose = act.items.flatMap((item) => (item.kind === "quest" ? [item.quest] : []));
		const main: Path = { title: "Main path", href: null, progress: null, waypoints: ordered(loose) };
		const paths = act.items.flatMap((item): Path[] => {
			if (item.kind === "quest") return item.quest === loose[0] ? [main] : [];
			const { epic } = item;
			return [
				{
					title: epic.title,
					href: file(epic.path),
					progress: epic.progress,
					waypoints: ordered(flatten(epic.items)),
				},
			];
		});
		return { act, href: `/repos/${project.name}#${actAnchor(act)}`, paths };
	});
}

/** A waypoint's status in the format's own terms. */
function text(status: Status): string {
	switch (status.kind) {
		case "available":
			return "ready";
		case "blocked":
			return "blocked";
		case "accepted":
			return `claimed by ${status.by}`;
		case "turn-in":
			return "in review";
	}
}

/** The waypoint's tooltip: its title and status, and what a blocked quest requires. */
function tooltip(quest: Quest): string {
	const { status } = quest;
	const line = `${quest.title}: ${text(status)}`;
	if (status.kind !== "blocked" || status.requires.length === 0) return line;
	return `${line}\nRequired: ${status.requires.map((ref) => ref.title).join(", ")}`;
}

function Stop(props: Waypoint) {
	const { quest } = props;
	const kind = quest.status.kind;
	const size = quest.size ? ` ql-${quest.size.toLowerCase()}` : "";
	// Screen readers hear the title first, then the size and status.
	const name = `${quest.title}, size ${quest.size ?? "unknown"}, ${text(quest.status)}`;
	return (
		<li class={`waypoint${size} waypoint-${kind}`}>
			<a href={props.href} title={tooltip(quest)} aria-label={name}>
				<span class="waypoint-node">
					<span class="waypoint-size">{quest.size ?? "?"}</span>
				</span>
				<span class="waypoint-text">
					<span class="waypoint-title">{quest.title}</span>
					<span class={`waypoint-status ${kind === "accepted" ? "muted" : `ql-${kind}`}`}>
						{text(quest.status)}
					</span>
				</span>
			</a>
		</li>
	);
}

export function QuestMap(props: { board: Board }) {
	const { board } = props;
	const web = board.project.web;
	const regions = chart(board);
	return (
		<div class="ql-ledger map">
			<ol class="map-regions" role="list">
				{regions.map(({ act, href, paths }) => (
					<li class="region">
						<header class="region-head">
							{act.number !== "" && <span class="eyebrow">Act {act.number}</span>}
							<h3>
								<a href={href}>{act.title}</a>
							</h3>
							<span class="muted region-count">
								{act.progress.done} of {act.progress.total} quests complete
							</span>
						</header>
						<ol class="map-paths" role="list">
							{paths.map((path) => (
								<li class="map-path">
									<p class="path-name">
										{path.href ? <a href={path.href}>{path.title}</a> : path.title}
										{path.progress && (
											<span class="muted">
												{" "}
												· {path.progress.done} of {path.progress.total} complete
											</span>
										)}
									</p>
									<ol class="trail" role="list">
										{path.waypoints.map((waypoint) => (
											<Stop {...waypoint} />
										))}
									</ol>
								</li>
							))}
						</ol>
					</li>
				))}
			</ol>
			<div class="map-legend">
				<p class="legend-sizes">
					<span class="muted">Size:</span>{" "}
					{(["XS", "S", "M", "L", "XL"] as const).map((size) => (
						<Difficulty size={size} />
					))}
				</p>
				<p class="muted">
					A solid waypoint is ready, claimed, or in review; a dashed one is blocked.{" "}
					{web && (
						<>
							Charted from <a href={`${web}/tree/${board.project.commit}/quest`}>quest/</a> on{" "}
							{board.project.date}.
						</>
					)}
				</p>
			</div>
		</div>
	);
}
