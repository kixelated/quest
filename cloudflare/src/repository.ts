import { DurableObject } from "cloudflare:workers";
import { evaluate, removeClaim } from "./core";
import { readSnapshot, SnapshotError } from "./snapshot";
import { runChangeMutation, runChangeCheck, writeFiles, type ChangeMutation, type ChangeIdentity } from "./mutations";
import { GitConflict } from "./git";
import { type PushEvent, eventKey, zeroId } from "./intake/events";
import { creditAuthor } from "./intake/claim";
import { provisionFork } from "./intake/forks";
import { gate, type FileChange } from "./intake/gate";
import { quarantineFiles, quarantinePaths } from "./intake/quarantine";
import { getFork, getRepository, requireMaintainer, IntakeError, type Actor, type Repository } from "./intake/registry";
import { SerialQueue } from "./intake/serial";
import { boundedText } from "./intake/subscriptions";

const claimLifetime = 48 * 60 * 60 * 1000;
interface Pending {
	operationId: string;
	expectedHead: string;
	files: FileChange[];
	author: { name: string; email: string };
	claim?: { path: string; forkName: string; text: string; claimedContent: string; unclaimedContent: string };
}
type Outcome = { status: "landed"; commitSha: string } | { status: "ignored" };

// Address with REPOSITORIES.getByName(the Artifacts repo name). Later quests
// add coordination operations here; quest state remains in the Git repository.
export class RepositoryCoordinator extends DurableObject<Env> {
	private readonly serial = new SerialQueue();
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO metadata VALUES (1, 1);
      CREATE TABLE IF NOT EXISTS repository_name (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registration (id INTEGER PRIMARY KEY CHECK(id=1), userId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, payload TEXT, result TEXT);
      CREATE TABLE IF NOT EXISTS claims (path TEXT PRIMARY KEY, forkName TEXT NOT NULL, text TEXT NOT NULL, claimedContent TEXT NOT NULL, unclaimedContent TEXT NOT NULL);
    `);
	}

	status() {
		const row = this.ctx.storage.sql
			.exec<{ schema_version: number }>("SELECT schema_version FROM metadata WHERE id = 1")
			.one();
		return { schemaVersion: row.schema_version };
	}

	private bind(name: string) {
		this.ctx.storage.sql.exec("INSERT OR IGNORE INTO repository_name VALUES(1, ?)", name);
		if (
			this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM repository_name WHERE id=1").one().name !==
			name
		)
			throw new IntakeError(409, "Coordinator repository mismatch");
	}

	private async head(repo: ArtifactsRepo): Promise<string> {
		const history = await repo.log({ ref: "refs/heads/main", limit: 1 });
		if (!history[0]) throw new IntakeError(409, "Repository needs an initial main commit");
		return history[0].hash;
	}

	private record(id: string) {
		return this.ctx.storage.sql
			.exec<{ payload: string | null; result: string | null }>(
				"SELECT payload,result FROM operations WHERE id=?",
				id,
			)
			.toArray()[0];
	}

	private async pending(repository: Repository, id: string, operation: Pending): Promise<Outcome> {
		this.ctx.storage.sql.exec(
			"INSERT INTO operations(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE operations.result IS NULL",
			id,
			JSON.stringify(operation),
		);
		// Git recovers a successful operation by ID/tree/parent before rejecting
		// a stale expected head. This journal survives a lost RPC and eviction.
		const commitSha = await writeFiles(this.env, repository, operation);
		this.ctx.storage.transactionSync(() => {
			if (operation.claim) {
				const claim = operation.claim;
				this.ctx.storage.sql.exec(
					"INSERT OR REPLACE INTO claims VALUES(?,?,?,?,?)",
					claim.path,
					claim.forkName,
					claim.text,
					claim.claimedContent,
					claim.unclaimedContent,
				);
			}
			this.ctx.storage.sql.exec(
				"UPDATE operations SET result=? WHERE id=?",
				JSON.stringify({ status: "landed", commitSha }),
				id,
			);
		});
		await this.schedule();
		return { status: "landed", commitSha };
	}

	private async schedule() {
		const claims = this.ctx.storage.sql
			.exec<{ forkName: string }>("SELECT DISTINCT forkName FROM claims")
			.toArray();
		let next = Infinity;
		for (const claim of claims) {
			const fork = await getFork(this.env.DB, claim.forkName);
			if (fork) next = Math.min(next, fork.lastPushAt + claimLifetime);
		}
		if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
		else await this.ctx.storage.deleteAlarm();
	}

	register(name: string, actor: Actor) {
		return this.serial.run(async () => {
			if (
				!this.env.AUTH_MAINTAINERS.split(",")
					.map((value) => value.trim())
					.includes(`${actor.provider}:${actor.identity}`)
			)
				throw new IntakeError(403, "Operator registration required");
			this.bind(name);
			using repo = await this.env.ARTIFACTS.get(name);
			const info = await repo.info();
			if (info.defaultBranch !== "main" || info.readOnly)
				throw new IntakeError(409, "A writable main repository is required");
			this.ctx.storage.sql.exec("INSERT OR IGNORE INTO registration VALUES(1,?)", actor.userId);
			if (
				this.ctx.storage.sql.exec<{ userId: string }>("SELECT userId FROM registration WHERE id=1").one()
					.userId !== actor.userId
			)
				throw new IntakeError(403, "Maintainer required");
			const existingOwner = await this.env.DB.prepare("SELECT maintainerId FROM repositories WHERE name=?")
				.bind(name)
				.first<{ maintainerId: string }>();
			if (existingOwner && existingOwner.maintainerId !== actor.userId)
				throw new IntakeError(403, "Maintainer required");
			const repository: Repository = {
				name,
				remote: info.remote,
				defaultBranch: "main",
				maintainerId: actor.userId,
			};
			const finish = async (outcome: Outcome) => {
				await this.env.DB.prepare("INSERT OR IGNORE INTO repositories VALUES(?,?,?,?,?)")
					.bind(name, info.remote, "main", actor.userId, Date.now())
					.run();
				return outcome;
			};
			const id = `quarantine:${name}`;
			const recorded = this.record(id);
			if (recorded?.result) return finish(JSON.parse(recorded.result) as Outcome);
			if (recorded?.payload) {
				try {
					return finish(await this.pending(repository, id, JSON.parse(recorded.payload)));
				} catch (error) {
					if (!(error instanceof GitConflict)) throw error;
					this.ctx.storage.sql.exec("UPDATE operations SET payload=NULL WHERE id=?", id);
				}
			}
			const expectedHead = await this.head(repo);
			const snapshot = await readSnapshot(repo, expectedHead);
			if (evaluate(snapshot).findings.length)
				throw new IntakeError(409, "Fix upstream quest validation before registration");
			const existing: Record<string, string | null> = {};
			for (const path of quarantinePaths) {
				const parts = path.split("/");
				for (let n = 1; n < parts.length; n++) {
					const parent = snapshot.entries.find((entry) => entry.path === parts.slice(0, n).join("/"));
					if (parent && parent.type !== "tree")
						throw new IntakeError(409, "Quarantine directories must be real directories");
				}
				const entry = snapshot.entries.find((entry) => entry.path === path);
				if (entry && (entry.type !== "blob" || entry.mode !== "100644"))
					throw new IntakeError(409, "Quarantine paths must be regular files");
				const blob = await repo.readFile({ ref: expectedHead, path });
				existing[path] = blob ? await boundedText(blob, 64 * 1024) : null;
			}
			let files: FileChange[];
			try {
				files = quarantineFiles(existing);
			} catch {
				throw new IntakeError(409, "Existing quarantine settings require maintainer reconciliation");
			}
			return finish(
				await this.pending(repository, id, {
					operationId: id,
					expectedHead,
					files,
					author: await creditAuthor(actor),
				}),
			);
		});
	}

	createFork(name: string, actor: Actor) {
		return this.serial.run(async () => {
			this.bind(name);
			return provisionFork(this.env, name, actor);
		});
	}

	ingest(event: PushEvent): Promise<Outcome> {
		return this.serial.run(async () => {
			const fork = await getFork(this.env.DB, event.source.repoName);
			if (
				!fork?.remote ||
				event.source.namespace !== this.env.ARTIFACTS_NAMESPACE ||
				event.metadata.accountId !== this.env.EVENT_ACCOUNT_ID ||
				event.metadata.eventSubscriptionId !== fork.subscriptionId
			)
				return { status: "ignored" };
			this.bind(fork.repositoryName);
			using source = await this.env.ARTIFACTS.get(fork.forkName);
			const info = await source.info();
			// Read fresh provider activity; event order and contributor dates do
			// not shorten or invent a claim's lease.
			const lastPushAt = Date.parse(info.lastPushAt ?? info.createdAt);
			if (!Number.isFinite(lastPushAt)) throw new Error("Invalid fork activity metadata");
			await this.env.DB.prepare("UPDATE forks SET lastPushAt = max(lastPushAt,?) WHERE forkName=?")
				.bind(lastPushAt, fork.forkName)
				.run();
			await this.schedule();
			const id = eventKey(event),
				recorded = this.record(id);
			if (recorded?.result) return JSON.parse(recorded.result) as Outcome;
			const repository = await getRepository(this.env.DB, fork.repositoryName);
			if (recorded?.payload) {
				try {
					return await this.pending(repository, id, JSON.parse(recorded.payload));
				} catch (error) {
					if (!(error instanceof GitConflict)) throw error;
					// Recovery already looked for a landed operation. A confirmed
					// stale-head conflict needs a fresh gate, not endless retries.
					this.ctx.storage.sql.exec("UPDATE operations SET payload=NULL WHERE id=?", id);
				}
			}
			const ignore = () => {
				this.ctx.storage.sql.exec(
					"INSERT INTO operations(id,result) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=NULL,result=excluded.result",
					id,
					JSON.stringify({ status: "ignored" }),
				);
				return { status: "ignored" } as const;
			};
			if (
				event.payload.ref !== "refs/heads/main" ||
				event.payload.before === zeroId ||
				event.payload.after === zeroId
			)
				return ignore();
			// First-parent ancestry is bounded. Arbitrary rewritten histories or
			// very large pushes are never promoted automatically.
			const ancestry = await source.log({ ref: event.payload.after, limit: 256 });
			if (!ancestry.some((commit) => commit.hash === event.payload.before)) return ignore();
			using upstream = await this.env.ARTIFACTS.get(repository.name);
			const expectedHead = await this.head(upstream);
			try {
				const before = await readSnapshot(source, event.payload.before);
				const after = await readSnapshot(source, event.payload.after);
				const current = await readSnapshot(upstream, expectedHead);
				const accepted = gate(before, after, current, fork);
				if (!accepted) return ignore();
				const claim =
					accepted.kind === "claim"
						? {
								path: accepted.file.path,
								forkName: fork.forkName,
								text: evaluate(after).claims[accepted.file.path].text,
								claimedContent: accepted.file.content!,
								unclaimedContent: current.documents.find(
									(document) => document.path === accepted.file.path,
								)!.content,
							}
						: undefined;
				return this.pending(repository, id, {
					operationId: id,
					expectedHead,
					files: [accepted.file],
					author: await creditAuthor(fork),
					claim,
				});
			} catch (error) {
				if (error instanceof SnapshotError) return ignore();
				throw error;
			}
		});
	}

	// All changes notes/reviews/merges use this same queue. Route callers supply
	// verified user IDs; authorization is rechecked within the mutation sequence.
	mutate(request: ChangeMutation) {
		return this.serial.run(async () => {
			this.bind(request.repositoryName);
			const repository = await getRepository(this.env.DB, request.repositoryName);
			const fork = await getFork(this.env.DB, request.forkName);
			if (
				!fork ||
				fork.repositoryName !== repository.name ||
				(request.kind !== "comment" && repository.maintainerId !== request.userId) ||
				(request.kind === "comment" &&
					repository.maintainerId !== request.userId &&
					fork.userId !== request.userId)
			)
				throw new IntakeError(403, "Mutation not authorized");
			return runChangeMutation(this.env, repository, request);
		});
	}

	checkChange(request: ChangeIdentity & { operationId: string }) {
		return this.serial.run(async () => {
			this.bind(request.repositoryName);
			return runChangeCheck(this.env, request);
		});
	}

	release(name: string, path: string, userId: string) {
		return this.serial.run(async () => {
			this.bind(name);
			const repository = await requireMaintainer(this.env.DB, name, userId);
			return this.remove(repository, path);
		});
	}

	private async remove(repository: Repository, path: string, expectedText?: string): Promise<Outcome> {
		using repo = await this.env.ARTIFACTS.get(repository.name);
		const expectedHead = await this.head(repo),
			snapshot = await readSnapshot(repo, expectedHead);
		const claim = evaluate(snapshot).claims[path];
		if (!claim || (expectedText !== undefined && claim.text !== expectedText)) {
			this.ctx.storage.sql.exec("DELETE FROM claims WHERE path=?", path);
			await this.schedule();
			return { status: "ignored" };
		}
		const content = snapshot.documents.find((document) => document.path === path)!.content;
		const tracked = this.ctx.storage.sql
			.exec<{ claimedContent: string; unclaimedContent: string }>(
				"SELECT claimedContent,unclaimedContent FROM claims WHERE path=?",
				path,
			)
			.toArray()[0];
		const unclaimed = tracked?.claimedContent === content ? tracked.unclaimedContent : removeClaim(content);
		const id = `release:${expectedHead}:${path}`;
		const result = await this.pending(repository, id, {
			operationId: id,
			expectedHead,
			files: [{ path, content: unclaimed }],
			author: { name: "Quest", email: "quest@localhost" },
		});
		this.ctx.storage.sql.exec("DELETE FROM claims WHERE path=?", path);
		await this.schedule();
		return result;
	}

	alarm() {
		return this.serial.run(async () => {
			const bound = this.ctx.storage.sql
				.exec<{ name: string }>("SELECT name FROM repository_name WHERE id=1")
				.toArray()[0];
			if (!bound) return;
			const repository = await getRepository(this.env.DB, bound.name);
			const claims = this.ctx.storage.sql
				.exec<{ path: string; forkName: string; text: string }>("SELECT path,forkName,text FROM claims")
				.toArray();
			for (const claim of claims) {
				const fork = await getFork(this.env.DB, claim.forkName);
				if (!fork) continue;
				using source = await this.env.ARTIFACTS.get(fork.forkName);
				const info = await source.info(),
					fresh = Date.parse(info.lastPushAt ?? info.createdAt);
				if (!Number.isFinite(fresh)) throw new Error("Invalid fork activity metadata");
				const lastPushAt = Math.max(fresh, fork.lastPushAt);
				await this.env.DB.prepare("UPDATE forks SET lastPushAt=? WHERE forkName=?")
					.bind(lastPushAt, fork.forkName)
					.run();
				if (lastPushAt + claimLifetime <= Date.now()) await this.remove(repository, claim.path, claim.text);
			}
			await this.schedule();
		});
	}
}
