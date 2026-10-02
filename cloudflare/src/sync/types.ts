export interface Pair {
	repositoryName: string;
	githubRepositoryId: number;
	installationId: number;
	owner: string;
	name: string;
	enabled: number;
	subscriptionId: string | null;
}
export type RefState = {
	ref: string;
	left: string | null;
	right: string | null;
	status: "equal" | "updated" | "diverged" | "deleted";
	shared: string | null;
};
// Scope only. Git validates complete ref-format rules before transport.
export function syncRef(ref: string): boolean {
	return ref === "refs/heads/main" || ref === "refs/notes/quest" || ref.startsWith("refs/heads/quest/");
}
