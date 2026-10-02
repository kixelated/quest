import { evaluate, removeClaim } from "./core";
import { assertQuestBranch, assertSha, GitConflict, type FileWrite, type GitAuthor, type ReviewNote } from "./git";
import {
	getRepository,
	requireFork,
	requireMaintainer,
	withCapability,
	IntakeError,
	type Repository,
} from "./intake/registry";

export interface ChangeIdentity {
	repositoryName: string;
	forkName: string;
	branch: string;
	head: string;
}
export type ChangeMutation = ChangeIdentity & { userId: string; operationId: string } & (
		| { kind: "comment"; text: string }
		| { kind: "approve"; checkedTree: string; expectedHead: string }
		| { kind: "merge"; checkedTree: string; expectedHead: string }
	);

export async function closeChange(env: Env, request: ChangeIdentity) {
	await env.DB.prepare("DELETE FROM changes WHERE repositoryName = ? AND forkName = ? AND branch = ? AND head = ?")
		.bind(request.repositoryName, request.forkName, request.branch, request.head)
		.run();
}

async function actor(env: Env, userId: string): Promise<GitAuthor> {
	const row = await env.DB.prepare('SELECT name, email FROM "user" WHERE id = ?').bind(userId).first<GitAuthor>();
	if (!row) throw new IntakeError(403, "Unknown reviewer");
	return row;
}

export async function writeFiles(
	env: Env,
	repository: Repository,
	request: { expectedHead: string; operationId: string; files: FileWrite[]; author: GitAuthor },
): Promise<string> {
	return withCapability(
		env,
		repository.name,
		"write",
		async (upstream) => (await env.GIT.getByName(repository.name).applyMutation(upstream, request)).commitSha,
	);
}

export async function inspectChange(env: Env, request: ChangeIdentity) {
	assertQuestBranch(request.branch);
	assertSha(request.head);
	const repository = await getRepository(env.DB, request.repositoryName);
	const fork = await requireFork(env.DB, repository.name, request.forkName);
	return withCapability(env, repository.name, "read", (upstream) =>
		withCapability(env, fork.forkName, "read", async (contributor) => {
			const git = env.GIT.getByName(repository.name);
			const raw = await git.inspect(upstream, contributor, request.branch, request.head);
			if (raw.merged) await closeChange(env, request);
			if (!raw.tree || !raw.snapshot || !raw.upstreamSnapshot)
				return {
					...raw,
					cleanup: [],
					result: null,
					notes: await git.notes(upstream, contributor, request.branch, request.head),
				};
			const questPath = `${request.branch}.md`;
			const upstreamResult = await evaluate(raw.upstreamSnapshot);
			const claim = upstreamResult.claims[questPath];
			if (
				claim &&
				(claim.provider !== fork.provider || claim.identity !== fork.identity || claim.location !== fork.remote)
			)
				throw new IntakeError(409, "Quest belongs to another claimant");
			const document = raw.snapshot.documents.find((entry) => entry.path === questPath);
			const cleanup: FileWrite[] = [];
			if (document) {
				const content = await removeClaim(document.content);
				if (content !== document.content) cleanup.push({ path: questPath, content });
			}
			const candidate = cleanup.length
				? await git.prepare(upstream, contributor, request.branch, request.head, cleanup)
				: raw;
			if (candidate.upstreamHead !== raw.upstreamHead || !candidate.tree || !candidate.snapshot)
				throw new GitConflict("Upstream changed during checks");
			const result = await evaluate(candidate.snapshot);
			const notes = await git.notes(upstream, contributor, request.branch, request.head);
			return { ...candidate, cleanup, result, notes };
		}),
	);
}

export function hasApproval(
	notes: ReviewNote[],
	request: ChangeIdentity,
	upstreamHead: string,
	tree: string,
	maintainerId: string,
): boolean {
	return notes.some(
		(note) =>
			note.version === 1 &&
			note.kind === "approve" &&
			note.actor.id === maintainerId &&
			note.head === request.head &&
			note.upstreamHead === upstreamHead &&
			note.tree === tree,
	);
}
export function hasCheck(notes: ReviewNote[], request: ChangeIdentity, upstreamHead: string, tree: string): boolean {
	return notes.some(
		(note) =>
			note.version === 1 &&
			note.kind === "check" &&
			note.head === request.head &&
			note.upstreamHead === upstreamHead &&
			note.tree === tree &&
			note.passed === true,
	);
}

// Called inside RepositoryCoordinator's single FIFO for every upstream writer.
// All authorization and check/approval state are re-read inside the operation.
export async function runChangeMutation(env: Env, repository: Repository, request: ChangeMutation) {
	const fork = await requireFork(env.DB, repository.name, request.forkName);
	if (request.repositoryName !== repository.name) throw new IntakeError(403, "Repository mismatch");
	if (request.kind === "comment") {
		if (request.userId !== repository.maintainerId && request.userId !== fork.userId)
			throw new IntakeError(403, "Contributor's own fork required");
	} else await requireMaintainer(env.DB, repository.name, request.userId);
	const author = await actor(env, request.userId);
	if (request.kind === "merge") {
		const recovered = await withCapability(env, repository.name, "read", (upstream) =>
			env.GIT.getByName(repository.name).recoverMutation(
				upstream,
				request.expectedHead,
				request.checkedTree,
				request.operationId,
			),
		);
		if (recovered) {
			await closeChange(env, request);
			return { commitSha: recovered.commitSha };
		}
	}
	const candidate = await inspectChange(env, request);
	if (candidate.merged) {
		await closeChange(env, request);
		throw new IntakeError(409, "Change already merged");
	}
	if (request.kind !== "comment") {
		if (!candidate.tree || !candidate.result || candidate.result.findings.length)
			throw new IntakeError(409, "Resolve conflicts and failed checks first");
		if (
			request.expectedHead !== candidate.upstreamHead ||
			request.checkedTree !== candidate.tree ||
			!hasCheck(candidate.notes, request, candidate.upstreamHead, candidate.tree)
		)
			throw new IntakeError(409, "Current head requires a successful push check");
	}
	return withCapability(env, repository.name, "write", (upstream) =>
		withCapability(env, fork.forkName, "read", async (contributor) => {
			const git = env.GIT.getByName(repository.name);
			if (request.kind === "merge") {
				if (
					!candidate.tree ||
					!hasApproval(
						candidate.notes,
						request,
						candidate.upstreamHead,
						candidate.tree,
						repository.maintainerId,
					)
				)
					throw new IntakeError(409, "Current checked head requires approval");
				const merged = await git.merge(upstream, contributor, {
					branch: request.branch,
					expectedHead: candidate.upstreamHead,
					expectedForkHead: request.head,
					expectedTree: candidate.tree,
					cleanup: candidate.cleanup,
					author,
					operationId: request.operationId,
				});
				await closeChange(env, request);
				return { commitSha: merged.commitSha };
			}
			const note: ReviewNote = {
				version: 1,
				kind: request.kind,
				operationId: request.operationId,
				head: request.head,
				actor: { id: request.userId, name: author.name },
				text: request.kind === "comment" ? request.text : "Approved",
				time: new Date().toISOString(),
				upstreamHead: candidate.upstreamHead,
				tree: candidate.tree ?? undefined,
			};
			return { notesCommit: await git.appendNote(upstream, contributor, request.branch, note, author) };
		}),
	);
}

export async function runChangeCheck(env: Env, request: ChangeIdentity & { operationId: string }) {
	const repository = await getRepository(env.DB, request.repositoryName);
	const fork = await requireFork(env.DB, repository.name, request.forkName);
	const candidate = await inspectChange(env, request);
	if (candidate.merged) {
		await closeChange(env, request);
		return { notesCommit: null };
	}
	const passed = !!candidate.tree && !!candidate.result && candidate.result.findings.length === 0;
	const note: ReviewNote = {
		version: 1,
		kind: "check",
		operationId: request.operationId,
		head: request.head,
		actor: { id: "quest-check", name: "Quest check" },
		text: candidate.conflicts ?? JSON.stringify(candidate.result?.findings ?? []),
		time: new Date().toISOString(),
		upstreamHead: candidate.upstreamHead,
		tree: candidate.tree ?? undefined,
		passed,
	};
	return withCapability(env, repository.name, "write", (upstream) =>
		withCapability(env, fork.forkName, "read", async (contributor) => {
			return {
				notesCommit: await env.GIT.getByName(repository.name).appendNote(
					upstream,
					contributor,
					request.branch,
					note,
					{ name: "Quest check", email: "quest-check@localhost" },
				),
			};
		}),
	);
}
