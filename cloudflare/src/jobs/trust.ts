import { GitHubService } from "../github/service";
import type { Verify } from "./store";

/** Recheck a queued PR job's head against current maintainer signatures. */
export const verify =
	(env: Env): Verify =>
	async (job) => {
		const repo = await env.DB.prepare("SELECT id,owner,name FROM github_projects WHERE id=?")
			.bind(job.repository)
			.first<{ id: number; owner: string; name: string }>();
		if (!repo) return false;
		try {
			return await new GitHubService(env).jobTrust(repo, job.target, job.head ?? job.revision);
		} catch {
			// A failed read never grants trust.
			return false;
		}
	};
