// A merge job holds its pull request with the `quest:merge` label, as local
// `quest merge` sessions do: from when the maintainer picks merge until the
// job ends without landing, or until a landing it started ends unmerged. Then
// the bot removes the label, and the pull request is an idle decision again.
import { GitHubService } from "../github/service";
import { pullOf } from "./publish";
import * as store from "./store";

/**
 * Release the holds of the ended merge jobs on a pull request that is not
 * queued or auto-merging. GitHub is read rather than trusted from whatever
 * event prompted this, so calling it again is harmless.
 */
export async function release(env: Env, repository: number, target: string) {
	const holds = await store.holding(env.DB, repository, target);
	if (!holds.length) return;
	const project = await env.DB.prepare("SELECT owner,name FROM github_projects WHERE id=?")
		.bind(repository)
		.first<{ owner: string; name: string }>();
	if (!project) return;
	const github = new GitHubService(env);
	for (const { id, hold } of holds) {
		try {
			if (await github.releasePullRequest({ ...project, id: repository }, pullOf(target), hold))
				await store.released(env.DB, id, hold);
		} catch (error) {
			// The next event on the pull request tries again.
			console.error({ event: "merge_hold_release_failed", name: error instanceof Error ? error.name : "unknown" });
		}
	}
}

/** Release a job's hold once it ended, if it is a merge job that holds one. */
export async function ended(env: Env, job: string) {
	const row = await env.DB.prepare("SELECT repository,target FROM jobs WHERE id=? AND workflow='merge' AND hold IS NOT NULL")
		.bind(job)
		.first<{ repository: number; target: string }>();
	if (row) await release(env, row.repository, row.target);
}
