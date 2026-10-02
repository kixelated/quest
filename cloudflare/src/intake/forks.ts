import { getFork, getRepository, IntakeError, type Actor, type Fork } from "./registry";
import { subscribeFork } from "./subscriptions";

export async function forkName(repositoryName: string, userId: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${repositoryName}\0${userId}`)),
	);
	return "fork-" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function provisionFork(env: Env, repositoryName: string, actor: Actor): Promise<Fork> {
	await getRepository(env.DB, repositoryName);
	const name = await forkName(repositoryName, actor.userId);
	// Reserve trusted ownership before external I/O. A failed/lost fork response
	// can then be recovered without assigning an existing repo to a new identity.
	await env.DB.prepare(
		"INSERT OR IGNORE INTO forks(forkName,repositoryName,userId,provider,identity,name,email,lastPushAt) VALUES(?,?,?,?,?,?,?,?)",
	)
		.bind(name, repositoryName, actor.userId, actor.provider, actor.identity, actor.name, actor.email, Date.now())
		.run();
	let row = (await getFork(env.DB, name))!;
	if (row.userId !== actor.userId || row.provider !== actor.provider || row.identity !== actor.identity)
		throw new IntakeError(403, "Fork ownership mismatch");
	if (!row.remote) {
		try {
			using existing = await env.ARTIFACTS.get(name);
			const info = await existing.info();
			if (
				info.source !== `artifacts:${env.ARTIFACTS_NAMESPACE}/${repositoryName}` ||
				info.readOnly ||
				info.defaultBranch !== "main"
			)
				throw new IntakeError(409, "Reserved fork metadata mismatch");
			// A prior provisioning response was lost. No token has been handed to
			// this contributor until this intent becomes ready.
			for (const token of (await existing.listTokens()).tokens) await existing.revokeToken(token.id);
			await env.DB.prepare("UPDATE forks SET remote = ? WHERE forkName = ?").bind(info.remote, name).run();
		} catch (error) {
			if (!(error && typeof error === "object" && "code" in error && error.code === "NOT_FOUND")) throw error;
			using upstream = await env.ARTIFACTS.get(repositoryName);
			const created = await upstream.fork(name, { defaultBranchOnly: true, readOnly: false });
			using fork = await env.ARTIFACTS.get(name);
			await fork.revokeToken(created.token);
			await env.DB.prepare("UPDATE forks SET remote = ? WHERE forkName = ?").bind(created.remote, name).run();
		}
		row = (await getFork(env.DB, name))!;
	}
	const record = await env.DB.prepare("SELECT subscriptionId FROM forks WHERE forkName = ?")
		.bind(name)
		.first<{ subscriptionId: string | null }>();
	if (!record?.subscriptionId) {
		const id = await subscribeFork(env, name);
		await env.DB.prepare("UPDATE forks SET subscriptionId = ? WHERE forkName = ?").bind(id, name).run();
	}
	return row;
}

export async function ownedFork(env: Env, repositoryName: string, actor: Actor): Promise<Fork> {
	const fork = await getFork(env.DB, await forkName(repositoryName, actor.userId));
	if (!fork?.remote || fork.userId !== actor.userId) throw new IntakeError(404, "Create your fork first");
	return fork;
}
