import { describe, expect, it } from "vitest";
import { finished } from "../scripts/history";
import { render } from "../src/board/markdown";
import { type Board, findGroup, only, readBoard, trail } from "../src/board/model";
import type { Project } from "../src/board/project";

const docs: Record<string, string> = {
	"quest/README.md": "# Quests\n\n## Goal\n\nShip it.\n\n## Required\n\n- [A0](/quest/a0/README.md) - first\n",
	"quest/a0/README.md":
		"# First release\n\n## Goal\n\nThe *first* release.\n\n## Required\n\n- [Epic](/quest/a0/epic/README.md) - grouped\n- [Solo](/quest/a0/solo.md) - alone\n",
	"quest/a0/epic/README.md":
		"# An epic\n\n## Goal\n\nGrouped work.\n\n## Required\n\n- [Ready](/quest/a0/epic/ready.md) - first\n- [Blocked](/quest/a0/epic/blocked.md) - second\n- [Taken](/quest/a0/epic/taken.md) - third\n- [Turned](/quest/a0/epic/turned.md) - fourth\n",
	"quest/a0/epic/ready.md": "# [S] Ready quest\n\n## Goal\n\nDo it.\n",
	"quest/a0/epic/blocked.md":
		"# [M] Blocked quest\n\n## Goal\n\nLater.\n\n## Required\n\n- [Ready](/quest/a0/epic/ready.md) - needs it\n",
	"quest/a0/epic/taken.md":
		"# [XL] Taken quest\n\n## Goal\n\nMine.\n\n## Claim\n\n- Jane Doe (github:jdoe) on https://example.com/jdoe/repo since 2026-10-02\n",
	"quest/a0/epic/turned.md": "# [XS] Turned-in quest\n\n## Goal\n\nDone soon.\n",
	"quest/a0/solo.md": "# [L] Solo quest\n\n## Goal\n\nAlone.\n",
	"quest/a0/loose.md": "# [S] Loose quest\n\n## Goal\n\nListed nowhere.\n",
};

function project(overrides: Partial<Project> = {}): Project {
	return {
		name: "demo",
		title: "acme/demo",
		web: "https://example.com/acme/demo",
		commit: "a".repeat(40),
		date: "2026-10-07",
		documents: Object.entries(docs).map(([path, content]) => ({ path, content })),
		completed: [
			{ path: "quest/a0/epic/old.md", title: "[L] Old quest", date: "2026-10-01", commit: "b".repeat(40) },
		],
		changes: [{ quest: "quest/a0/epic/turned.md", author: "@sam", href: "/repos/demo/changes/sam" }],
		issues: [],
		...overrides,
	};
}

const status = (board: Board, path: string) => board.quests.get(path)?.status;

describe("board model", () => {
	const board = readBoard(project());

	it("uses open changes and dependencies, ignoring legacy Claim sections", () => {
		expect(status(board, "quest/a0/epic/ready.md")).toEqual({ kind: "available" });
		expect(status(board, "quest/a0/epic/blocked.md")).toEqual({
			kind: "blocked",
			requires: [{ title: "Ready quest", href: "/repos/demo/quest/a0/epic/ready" }],
		});
		expect(status(board, "quest/a0/epic/taken.md")).toEqual({ kind: "available" });
		expect(status(board, "quest/a0/epic/turned.md")?.kind).toBe("turn-in");
		expect(board.counts).toEqual({ available: 4, blocked: 1, "turn-in": 1 });
	});

	it("groups acts and epics in priority order, then unlisted quests", () => {
		const [act] = board.acts;
		expect(act).toMatchObject({ number: "0", title: "First release", summary: "The first release." });
		expect(act.items.map((item) => (item.kind === "quest" ? item.quest.path : item.epic.path))).toEqual([
			"quest/a0/epic/README.md",
			"quest/a0/solo.md",
			"quest/a0/loose.md",
		]);
		expect(trail(board, "quest/a0/epic/ready.md").map((group) => group.title)).toEqual([
			"First release",
			"An epic",
		]);
		expect(trail(board, "quest/a0/epic/README.md").map((group) => group.title)).toEqual(["First release"]);
	});

	it("weights progress by difficulty and counts finished quests from history", () => {
		// Finished: L (5). Open: S 2, M 3, XL 8, XS 1 in the epic; L 5 and S 2 outside it.
		expect(findGroup(board, "quest/a0/epic/README.md")!.progress).toEqual({
			done: 1,
			total: 5,
			weight: 5,
			totalWeight: 19,
		});
		expect(board.acts[0].progress).toEqual({ done: 1, total: 7, weight: 5, totalWeight: 26 });
		expect(board.finished[0]).toMatchObject({ name: "Old quest", size: "L", act: "Act 0" });
	});

	it("filters by status, dropping empty epics", () => {
		const items = only(board.acts[0].items, "blocked");
		expect(items).toHaveLength(1);
		expect(items[0].kind === "epic" && items[0].epic.items.length).toBe(1);
	});
});

describe("quest markdown", () => {
	const known = (path: string) => path in docs;

	it("escapes HTML and drops unsafe links and images", () => {
		const [goal] = render(
			project(),
			"quest/a0/solo.md",
			'# T\n\n## Goal\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![pic](https://example.com/p.png) <b onclick="x">b</b>\n',
			known,
		);
		expect(goal.heading).toBe("Goal");
		expect(goal.html).not.toContain("<script");
		expect(goal.html).not.toContain("<b ");
		expect(goal.html).not.toContain("javascript:");
		expect(goal.html).not.toContain("<img");
		expect(goal.html).toContain("&#60;script&#62;");
	});

	it("escapes text after an inline raw tag, closed or not", () => {
		for (const tag of ["code", "pre", "kbd", "script"]) {
			for (const close of [`</${tag}>`, ""]) {
				const [goal] = render(
					project(),
					"quest/a0/solo.md",
					`## Goal\n\na <${tag}> <img src=x onerror=alert(1)// ${close}\n\nlater <b>bold</b>\n`,
					known,
				);
				expect(goal.html).not.toMatch(/<(img|b)\b/);
			}
		}
	});

	it("opens quest links on the board and other files where the repository is published", () => {
		const [plan] = render(
			project(),
			"quest/a0/solo.md",
			"## Plan\n\n[epic](/quest/a0/epic/README.md#goal) [ready](epic/ready.md) [docs](../../docs/a.md) [web](https://example.com)\n",
			known,
		);
		expect(plan.html).toContain('href="/repos/demo/quest/a0/epic#goal"');
		expect(plan.html).toContain('href="/repos/demo/quest/a0/epic/ready"');
		expect(plan.html).toContain('href="https://example.com/acme/demo/blob/main/docs/a.md"');
		expect(plan.html).toContain('href="https://example.com"');
		const [unpublished] = render(
			project({ web: null }),
			"quest/a0/solo.md",
			"## Plan\n\n[docs](/docs/a.md)\n",
			known,
		);
		expect(unpublished.html).toBe("<p>docs</p>\n");
	});
});

describe("finished quests from history", () => {
	const commit = (sha: string, date: string, ...changes: string[]) => `\0${sha} ${date}\n\n${changes.join("\n")}\n`;
	const titles: Record<string, string> = {
		"old^:quest/m0/epic/done.md": "# [M] Done in the old act\n",
		"plan^:quest/m0/dropped.md": "# [S] Dropped\n",
	};
	const read = (rev: string, path: string) => titles[`${rev}:${path}`];

	it("counts deletions that shipped work, following later directory renames", () => {
		const log = [
			commit("rename", "2026-10-09", "R100\tquest/m0/README.md\tquest/a0/README.md", "M\tsrc/a.ts"),
			commit("plan", "2026-10-08", "D\tquest/m0/dropped.md"),
			commit("old", "2026-10-07", "D\tquest/m0/epic/done.md", "M\tsrc/b.ts", "D\tquest/AGENTS.md"),
		].join("");
		const now = new Set(["quest/README.md", "quest/a0/README.md", "quest/a0/epic/README.md"]);
		expect(finished(log, now, read)).toEqual([
			{ path: "quest/a0/epic/done.md", title: "[M] Done in the old act", date: "2026-10-07", commit: "old" },
		]);
	});

	it("follows a rename made in the same commit that finishes a quest", () => {
		// Git lists changes by path, so the deletion can come before the rename.
		const log = commit(
			"rename",
			"2026-10-09",
			"D\tquest/m0/a.md",
			"R100\tquest/m0/b.md\tquest/a0/b.md",
			"M\tsrc/a.ts",
		);
		const read = () => "# [S] Finished with the rename\n";
		expect(finished(log, new Set(["quest/a0/b.md"]), read).map((c) => c.path)).toEqual(["quest/a0/a.md"]);
	});

	it("skips a quest that still exists, moved too far for Git to pair the rename", () => {
		const log = commit("move", "2026-10-09", "D\tquest/a0/a.md", "A\tquest/a0/epic/a.md", "M\tsrc/a.ts");
		const read = () => "# [S] Moved\n";
		expect(finished(log, new Set(["quest/a0/a.md"]), read)).toEqual([]);
	});
});
