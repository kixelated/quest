interface Subscription {
	id: string;
	name: string;
	enabled: boolean;
	source: { type: string; namespace?: string; repo_name?: string };
	destination: { type: string; queue_id: string };
	events: string[];
}

export async function boundedText(blob: Blob, limit: number): Promise<string> {
	if (blob.size > limit) throw new Error("Content size limit exceeded");
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer());
}

async function api<T>(env: Env, suffix: string, body?: unknown): Promise<T> {
	if (!/^[a-f0-9]{32}$/.test(env.EVENT_ACCOUNT_ID) || !/^[a-f0-9]{32}$/.test(env.EVENT_QUEUE_ID))
		throw new Error("Event subscription account/queue configuration required");
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.EVENT_ACCOUNT_ID}/event_subscriptions/subscriptions${suffix}`,
		{
			method: body === undefined ? "GET" : "POST",
			headers: { Authorization: `Bearer ${env.EVENT_SUBSCRIPTION_TOKEN}`, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
	);
	if (!response.ok) throw new Error("Event subscription request failed");
	// Only the provider response is decoded. Do not log raw responses/tokens.
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Empty event subscription response");
	let text = "",
		size = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 1_048_576) {
				await reader.cancel();
				throw new Error("Event subscription response limit exceeded");
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	const result = JSON.parse(text) as { success: boolean; result: T };
	if (!result.success || !result.result) throw new Error("Event subscription request failed");
	return result.result;
}

// There is no event-subscription Worker binding. This is the one management
// API request; Artifacts content/token operations use the native binding.
export async function subscribeFork(env: Env, forkName: string): Promise<string> {
	const name = `quest-intake:${forkName}`;
	for (let page = 1; ; page++) {
		const subscriptions = await api<Subscription[]>(
			env,
			`?queue_id=${env.EVENT_QUEUE_ID}&per_page=50&page=${page}`,
		);
		const existing = subscriptions.find(
			(item) =>
				item.name === name &&
				item.enabled &&
				item.source.type === "artifacts.repo" &&
				item.source.namespace === env.ARTIFACTS_NAMESPACE &&
				item.source.repo_name === forkName &&
				item.events.includes("cf.artifacts.repo.pushed") &&
				item.destination.queue_id === env.EVENT_QUEUE_ID,
		);
		if (existing) return existing.id;
		if (subscriptions.length < 50) break;
	}
	const created = await api<Subscription>(env, "", {
		name,
		enabled: true,
		source: { type: "artifacts.repo", namespace: env.ARTIFACTS_NAMESPACE, repo_name: forkName },
		destination: { type: "queues.queue", queue_id: env.EVENT_QUEUE_ID },
		events: ["cf.artifacts.repo.pushed"],
	});
	return created.id;
}
