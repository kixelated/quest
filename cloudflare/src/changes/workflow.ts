import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { assertQuestBranch, assertSha, operationKey } from "../git";
import { withCapability, type Fork } from "../intake/registry";
import type { ChangeIdentity } from "../mutations";

export class ChangeChecks extends WorkflowEntrypoint<Env, ChangeIdentity> {
	async run(event: WorkflowEvent<ChangeIdentity>, step: WorkflowStep) {
		return step.do("Check immutable change and record head-bound note", async () => {
			return this.env.REPOSITORIES.getByName(event.payload.repositoryName).checkChange({ ...event.payload, operationId: event.instanceId });
		});
	}
}

export async function dispatchChangeCheck(env: Env, identity: ChangeIdentity): Promise<string> {
	assertQuestBranch(identity.branch); assertSha(identity.head);
	const base = await withCapability(env, identity.repositoryName, "read", (upstream) => env.GIT.getByName(identity.repositoryName).head(upstream, "refs/heads/main"));
	if (!base) throw new Error("Missing upstream main");
	const id = await operationKey(`change:${identity.repositoryName}:${identity.forkName}:${identity.branch}:${identity.head}:${base}`);
	// The documented batch API is idempotent for existing instance IDs.
	await env.CHANGE_CHECKS.createBatch([{ id, params: identity }]);
	return id;
}

// Called only after intake verifies the subscription against its trusted fork.
export async function dispatchChangePush(env: Env, event: { payload: { ref: string; after: string } }, fork: Fork) {
	if (!event.payload.ref.startsWith("refs/heads/quest/")) return;
	const branch = event.payload.ref.slice("refs/heads/".length);
	assertQuestBranch(branch); assertSha(event.payload.after);
	const current = await withCapability(env, fork.forkName, "read", (capability) => env.GIT.getByName(fork.repositoryName).head(capability, event.payload.ref));
	if (event.payload.after === "0".repeat(40) && current === null) {
		await env.DB.prepare("DELETE FROM changes WHERE repositoryName = ? AND forkName = ? AND branch = ?").bind(fork.repositoryName, fork.forkName, branch).run();
		return;
	}
	if (current !== event.payload.after) return; // A newer push superseded this queue event.
	await env.DB.prepare("INSERT INTO changes VALUES (?, ?, ?, ?, ?) ON CONFLICT(repositoryName, forkName, branch) DO UPDATE SET head = excluded.head, updatedAt = excluded.updatedAt")
		.bind(fork.repositoryName, fork.forkName, branch, event.payload.after, Date.now()).run();
	await dispatchChangeCheck(env, { repositoryName: fork.repositoryName, forkName: fork.forkName, branch, head: event.payload.after });
}
