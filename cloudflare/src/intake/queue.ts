import { dispatchArtifactsSync } from "../sync/workflow";
import { dispatchChangePush } from "../changes/workflow";
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
			if (await dispatchArtifactsSync(env, event)) {
				message.ack();
				continue;
			}
			const fork = await getFork(env.DB, event.source.repoName);
			if (fork && event.metadata.eventSubscriptionId === fork.subscriptionId) {
				await env.REPOSITORIES.getByName(fork.repositoryName).ingest(event);
				await dispatchChangePush(env, event, fork);
			}
			message.ack();
		} catch (error) {
			console.error({ event: "intake_failed", name: error instanceof Error ? error.name : "Error" });
			message.retry();
		}
	}
}
