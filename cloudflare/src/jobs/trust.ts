import { GitHubService } from "../github/service";
import { publicationHead } from "./publish";
import type { AssignmentSource, VerifiedSource } from "./store";

/** Recover only a confirmed, fenced publication before classifying a queued PR revision. */
export async function verify(env: Env, job: AssignmentSource): Promise<VerifiedSource> {
	const untrusted = { head: job.head, trusted: false };
	const repo = await env.DB.prepare("SELECT id,owner,name FROM github_projects WHERE id=?")
		.bind(job.repository)
		.first<{ id: number; owner: string; name: string }>();
	if (!repo) return untrusted;
	const github = new GitHubService(env);
	try {
		const head = job.pending
			? await github.contribute(repo, job.actor, job, (branch) => publicationHead(env.DB, job, branch))
			: job.head;
		return { head, trusted: await github.jobTrust(repo, job.target, head ?? job.revision) };
	} catch {
		// A failed read, changed branch, or unconfirmed publication never grants trust.
		return untrusted;
	}
}
