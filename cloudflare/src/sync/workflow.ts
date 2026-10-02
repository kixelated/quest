import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { operationKey } from "../git";
import type { PushEvent } from "../intake/events";
import { getPair } from "./service";
export class GithubSync extends WorkflowEntrypoint<Env, { repositoryName: string }> {
	async run(event: WorkflowEvent<{ repositoryName: string }>, step: WorkflowStep) {
		return step.do("Reconcile authoritative paired refs", async () => {
			using result = await this.env.REPOSITORIES.getByName(event.payload.repositoryName).syncGithub(
				event.payload.repositoryName,
			);
			return { status: result.status };
		});
	}
}
export async function dispatchSync(env: Env, repositoryName: string, eventKey: string) {
	const id = await operationKey(`sync:${repositoryName}:${eventKey}`);
	await env.GITHUB_SYNC.createBatch([{ id, params: { repositoryName } }]);
	return id;
}
export async function dispatchArtifactsSync(env: Env, event: PushEvent): Promise<boolean> {
	const pair = await getPair(env, event.source.repoName);
	if (!pair?.enabled) return false;
	if (
		event.source.namespace !== env.ARTIFACTS_NAMESPACE ||
		event.metadata.accountId !== env.EVENT_ACCOUNT_ID ||
		event.metadata.eventSubscriptionId !== pair.subscriptionId
	)
		return true;
	await dispatchSync(env, pair.repositoryName, `${event.payload.ref}:${event.payload.before}:${event.payload.after}`);
	return true;
}
// GitHub webhooks are only hints. Poll also covers notes refs, oversized/skipped
// deliveries and crashes between provider writes and our status cache.
export async function pollSync(env: Env) {
	let after = "";
	const bucket = Math.floor(Date.now() / 300000);
	while (true) {
		const rows = await env.DB.prepare(
			"SELECT repositoryName FROM github_pairs WHERE enabled=1 AND repositoryName>? ORDER BY repositoryName LIMIT 100",
		)
			.bind(after)
			.all<{ repositoryName: string }>();
		for (const row of rows.results) await dispatchSync(env, row.repositoryName, `poll:${bucket}`);
		if (rows.results.length < 100) break;
		after = rows.results.at(-1)!.repositoryName;
	}
}
