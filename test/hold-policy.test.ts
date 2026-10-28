import { describe, expect, test } from "vitest";
import {
	HOLD_PREFIX,
	MERGE_LABEL,
	heldToken,
	isHoldLabel,
	latestHold,
	spentMergeHold,
	type HoldSnapshot,
} from "../src/core";

const added = { id: "first", label: MERGE_LABEL, time: 1 };
const snapshot = (change: Partial<HoldSnapshot> = {}): HoldSnapshot => ({
	labels: [MERGE_LABEL],
	events: [added, { id: "landing", label: null }],
	landing: false,
	...change,
});

describe("shared hold policy", () => {
	test("recognizes all hold labels without treating ordinary labels as holds", () => {
		expect(HOLD_PREFIX).toBe("quest:");
		for (const label of [MERGE_LABEL, "quest:ready", "quest:iterate", "quest:custom"])
			expect(isHoldLabel(label)).toBe(true);
		for (const label of ["quest", "bug", "other:quest:merge"]) expect(isHoldLabel(label)).toBe(false);
	});

	test("only the latest addition owns a present label, preserving event metadata", () => {
		const latest = { id: "second", label: MERGE_LABEL, time: 2 };
		const state = snapshot({ events: [added, latest] });
		expect(latestHold([added, latest], MERGE_LABEL)).toBe(latest);
		expect(heldToken(state, MERGE_LABEL)).toBe("second");
		expect(heldToken({ ...state, labels: [] }, MERGE_LABEL)).toBeUndefined();
		expect(heldToken({ ...state, events: [] }, MERGE_LABEL)).toBeUndefined();
	});

	test("spends a merge hold only after its own later landing ends", () => {
		expect(spentMergeHold(snapshot())).toBe(true);
		expect(spentMergeHold(snapshot({ landing: true }))).toBe(false);
		expect(spentMergeHold(snapshot({ labels: [] }))).toBe(false);
		expect(spentMergeHold(snapshot({ events: [] }))).toBe(false);
		expect(spentMergeHold(snapshot({ events: [{ id: "older-landing", label: null }, added] }))).toBe(false);
		expect(spentMergeHold(snapshot({ events: [added, { id: "bug", label: "bug" }] }))).toBe(false);
		expect(
			spentMergeHold(
				snapshot({ events: [added, { id: "landing", label: null }, { id: "new", label: MERGE_LABEL }] }),
			),
		).toBe(false);
	});
});
