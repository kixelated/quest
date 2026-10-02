import { pushEvent } from "./events";
import { getFork } from "./registry";

export async function consumePushes(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		const event = pushEvent(message.body);
		if (
			!event ||
			event.source.namespace !== env.ARTIFACTS_NAMESPACE ||
			event.metadata.accountId !== env.EVENT_ACCOUNT_ID
		) {
			message.ack();
			continue;
		}
		try {
			const fork = await getFork(env.DB, event.source.repoName);
			if (fork) await env.REPOSITORIES.getByName(fork.repositoryName).ingest(event);
			message.ack();
		} catch (error) {
			console.error({ event: "intake_failed", name: error instanceof Error ? error.name : "Error" });
			message.retry();
		}
	}
}
