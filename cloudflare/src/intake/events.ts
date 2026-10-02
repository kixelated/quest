export interface PushEvent {
	type: "cf.artifacts.repo.pushed";
	source: { type: "artifacts.repo"; namespace: string; repoName: string };
	payload: { ref: string; before: string; after: string };
	metadata: { accountId: string; eventSubscriptionId: string; eventTimestamp: string; eventSchemaVersion: 1 };
}

export const objectId = /^[a-f0-9]{40}$/;
export const zeroId = "0".repeat(40);

// Treat the Queue envelope as data. Commit authors and event IDs are not identities.
export function pushEvent(value: unknown): PushEvent | null {
	if (!value || typeof value !== "object") return null;
	const event = value as Partial<PushEvent>;
	if (
		event.type !== "cf.artifacts.repo.pushed" ||
		event.source?.type !== "artifacts.repo" ||
		typeof event.source.namespace !== "string" ||
		typeof event.source.repoName !== "string" ||
		typeof event.payload?.ref !== "string" ||
		!objectId.test(event.payload.before ?? "") ||
		!objectId.test(event.payload.after ?? "") ||
		event.metadata?.eventSchemaVersion !== 1 ||
		typeof event.metadata.accountId !== "string" ||
		typeof event.metadata.eventSubscriptionId !== "string" ||
		!Number.isFinite(Date.parse(event.metadata.eventTimestamp ?? ""))
	)
		return null;
	return event as PushEvent;
}

export function eventKey(event: PushEvent): string {
	return [
		event.source.namespace,
		event.source.repoName,
		event.payload.ref,
		event.payload.before,
		event.payload.after,
	].join(":");
}
