// A hold is a label plus the event that most recently added it. Callers load
// labels and ordered events from their tracker and apply the resulting rule.
export const HOLD_PREFIX = "quest:";
export const MERGE_LABEL = `${HOLD_PREFIX}merge`;

export interface HoldEvent {
	id: string;
	/** The label added, or null when a landing started. */
	label: string | null;
}
export interface HoldSnapshot {
	labels: readonly string[];
	/** Oldest first. */
	events: readonly HoldEvent[];
	landing: boolean;
}

export function isHoldLabel(label: string): boolean {
	return label.startsWith(HOLD_PREFIX);
}

/** Preserve a caller's extra event fields, such as its timestamp. */
export function latestHold<T extends HoldEvent>(events: readonly T[], label: string): T | undefined {
	for (let index = events.length - 1; index >= 0; index--) if (events[index].label === label) return events[index];
	return undefined;
}

/** A present label is owned only by its most recent addition. */
export function heldToken(snapshot: Pick<HoldSnapshot, "labels" | "events">, label: string): string | undefined {
	return snapshot.labels.includes(label) ? latestHold(snapshot.events, label)?.id : undefined;
}

/** A merge hold is spent after a later landing ended, while a live landing keeps it. */
export function spentMergeHold(snapshot: HoldSnapshot): boolean {
	const added = latestHold(snapshot.events, MERGE_LABEL);
	if (!added || snapshot.landing || !snapshot.labels.includes(MERGE_LABEL)) return false;
	return snapshot.events.slice(snapshot.events.indexOf(added) + 1).some((later) => later.label === null);
}
