export interface Actor {
	userId: string;
	provider: string;
	identity: string;
	name: string;
	email: string;
}

export interface Repository {
	name: string;
	remote: string;
	defaultBranch: "main";
	maintainerId: string;
}

export interface Fork extends Actor {
	forkName: string;
	repositoryName: string;
	remote: string | null;
	lastPushAt: number;
	subscriptionId: string | null;
}

export interface Capability {
	name: string;
	remote: string;
	token: string;
}

export class IntakeError extends Error {
	constructor(
		public readonly status: 400 | 401 | 403 | 404 | 409,
		message: string,
	) {
		super(message);
	}
}

export async function getRepository(db: D1Database, name: string): Promise<Repository> {
	const row = await db
		.prepare("SELECT name, remote, defaultBranch, maintainerId FROM repositories WHERE name = ?")
		.bind(name)
		.first<Repository>();
	if (!row) throw new IntakeError(404, "Unknown repository");
	return row;
}

export async function requireMaintainer(db: D1Database, name: string, userId: string): Promise<Repository> {
	const repository = await getRepository(db, name);
	if (repository.maintainerId !== userId) throw new IntakeError(403, "Maintainer required");
	return repository;
}

export function getFork(db: D1Database, forkName: string): Promise<Fork | null> {
	return db.prepare("SELECT * FROM forks WHERE forkName = ?").bind(forkName).first<Fork>();
}

export async function requireFork(db: D1Database, repositoryName: string, forkName: string): Promise<Fork> {
	const fork = await getFork(db, forkName);
	if (!fork || fork.repositoryName !== repositoryName || !fork.remote) throw new IntakeError(404, "Unknown fork");
	return fork;
}

// Neither application storage nor the Git repository receives a long-lived upstream credential.
export async function withCapability<T>(
	env: Env,
	name: string,
	scope: "read" | "write",
	fn: (capability: Capability) => Promise<T>,
): Promise<T> {
	using repo = await env.ARTIFACTS.get(name);
	const info = await repo.info();
	const token = await repo.createToken(scope, 300);
	try {
		return await fn({ name, remote: info.remote, token: token.plaintext });
	} finally {
		await repo.revokeToken(token.id);
	}
}
