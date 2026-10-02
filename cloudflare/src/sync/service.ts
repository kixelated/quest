import { getRepository, requireMaintainer, IntakeError, withCapability } from "../intake/registry";
import { subscribeFork } from "../intake/subscriptions";
import { verifyGithubMaintainer, withGithub, positiveId } from "./github";
import type { Pair } from "./types";
export async function getPair(env: Env, repositoryName: string): Promise<Pair | null> {
	return env.DB.prepare("SELECT * FROM github_pairs WHERE repositoryName=?").bind(repositoryName).first<Pair>();
}
export async function pairGithub(
	env: Env,
	request: { repositoryName: string; userId: string; installationId: number; githubRepositoryId: number },
) {
	await requireMaintainer(env.DB, request.repositoryName, request.userId);
	if (!positiveId(request.installationId) || !positiveId(request.githubRepositoryId))
		throw new IntakeError(400, "Invalid GitHub IDs");
	const previous = await getPair(env, request.repositoryName);
	if (
		previous &&
		(previous.githubRepositoryId !== request.githubRepositoryId ||
			previous.installationId !== request.installationId)
	)
		throw new IntakeError(409, "Repository already paired; disable and reconcile before changing its pairing");
	const repo = await verifyGithubMaintainer(env, request.userId, request.installationId, request.githubRepositoryId);
	await env.DB.prepare(
		"INSERT INTO github_pairs(repositoryName,githubRepositoryId,installationId,owner,name) VALUES(?,?,?,?,?) ON CONFLICT(repositoryName) DO UPDATE SET owner=excluded.owner,name=excluded.name",
	)
		.bind(request.repositoryName, request.githubRepositoryId, request.installationId, repo.owner.login, repo.name)
		.run();
	return { paired: true };
}
// Onboarding invokes this only after its init PR merges. Installation/import
// alone never calls it. Ordinary settings require an explicit maintainer action.
export async function enableGithub(env: Env, request: { repositoryName: string; userId: string; enabled: boolean }) {
	await requireMaintainer(env.DB, request.repositoryName, request.userId);
	const pair = await getPair(env, request.repositoryName);
	if (!pair) throw new IntakeError(404, "Repository not paired");
	if (request.enabled) {
		await verifyGithubMaintainer(env, request.userId, pair.installationId, pair.githubRepositoryId);
		const subscription = await subscribeFork(env, request.repositoryName);
		await env.DB.prepare("UPDATE github_pairs SET subscriptionId=?,enabled=1 WHERE repositoryName=?")
			.bind(subscription, request.repositoryName)
			.run();
	} else
		await env.DB.prepare("UPDATE github_pairs SET enabled=0 WHERE repositoryName=?")
			.bind(request.repositoryName)
			.run();
	return { enabled: request.enabled };
}
export async function syncGithub(env: Env, repositoryName: string) {
	await getRepository(env.DB, repositoryName);
	const pair = await getPair(env, repositoryName);
	if (!pair?.enabled) return { status: "disabled" };
	const rows = await env.DB.prepare("SELECT ref,shared FROM sync_refs WHERE repositoryName=?")
		.bind(repositoryName)
		.all<{ ref: string; shared: string | null }>();
	const previous = Object.fromEntries(rows.results.filter((row) => row.shared).map((row) => [row.ref, row.shared!]));
	const states = await withCapability(env, repositoryName, "write", (upstream) =>
		withGithub(env, pair, async (github) => {
			const git = env.GIT.getByName(repositoryName);
			using left = await git.refs(upstream);
			using right = await git.refs(github);
			const observed = {
				left: Object.fromEntries(Object.entries(left)),
				right: Object.fromEntries(Object.entries(right)),
			};
			// Persist a receipt BEFORE the first write. A lost response followed by
			// deletion cannot turn a formerly mirrored ref back into a new ref.
			// An uncertain first-copy failure therefore requires reconciliation.
			const refs = [...new Set([...Object.keys(observed.left), ...Object.keys(observed.right)])];
			if (refs.length)
				await env.DB.batch(
					refs.map((ref) =>
						env.DB.prepare(
							"INSERT INTO sync_refs VALUES(?,?,?,?,?,?,?) ON CONFLICT(repositoryName,ref) DO NOTHING",
						).bind(
							repositoryName,
							ref,
							observed.left[ref] ?? observed.right[ref],
							observed.left[ref] ?? null,
							observed.right[ref] ?? null,
							"pending",
							Date.now(),
						),
					),
				);
			using result = await git.mirror(upstream, github, previous, observed);
			return result.map((row) => ({ ...row }));
		}),
	);
	if (states.length)
		await env.DB.batch(
			states.map((state) =>
				env.DB.prepare(
					"INSERT INTO sync_refs VALUES(?,?,?,?,?,?,?) ON CONFLICT(repositoryName,ref) DO UPDATE SET shared=COALESCE(excluded.shared,sync_refs.shared),leftHead=excluded.leftHead,rightHead=excluded.rightHead,status=excluded.status,updatedAt=excluded.updatedAt",
				).bind(repositoryName, state.ref, state.shared, state.left, state.right, state.status, Date.now()),
			),
		);
	return {
		status: states.some((state) => state.status === "diverged" || state.status === "deleted")
			? "conflict"
			: "synced",
	};
}
