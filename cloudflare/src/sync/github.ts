import { createPrivateKey, sign } from "node:crypto";
import type { GitCapability } from "../git";
import type { Pair } from "./types";
import { IntakeError } from "../intake/registry";
export function positiveId(id: unknown): id is number {
	return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}
export function githubName(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) && value !== "..";
}
async function boundedJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Empty GitHub response");
	let length = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 1048576) {
				await reader.cancel();
				throw new Error("GitHub response limit exceeded");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
}
export function appJwt(env: Env): string {
	if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub App configuration required");
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const now = Math.floor(Date.now() / 1000),
		data = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`;
	return `${data}.${sign("RSA-SHA256", Buffer.from(data), createPrivateKey(env.GITHUB_APP_PRIVATE_KEY)).toString("base64url")}`;
}
export async function githubApi<T>(token: string, path: string, body?: unknown): Promise<T> {
	if (!path.startsWith("/")) throw new Error("Invalid GitHub API path");
	return (await boundedJson(
		await fetch(`https://api.github.com${path}`, {
			method: body === undefined ? "GET" : "POST",
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2026-03-10",
				"User-Agent": "Quest-GitHub-App",
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	)) as T;
}
export interface GithubRepository {
	id: number;
	name: string;
	owner: { login: string };
	default_branch: string;
	archived: boolean;
	disabled: boolean;
}
export async function installationToken(env: Env, installationId: number, repositoryId: number): Promise<string> {
	if (!positiveId(installationId) || !positiveId(repositoryId)) throw new IntakeError(400, "Invalid GitHub IDs");
	const result = await githubApi<{ token: string; permissions: { contents?: string; workflows?: string } }>(
		appJwt(env),
		`/app/installations/${installationId}/access_tokens`,
		{ repository_ids: [repositoryId], permissions: { contents: "write", workflows: "write" } },
	);
	if (typeof result.token !== "string" || !result.token || result.permissions.contents !== "write")
		throw new Error("GitHub write capability required");
	return result.token;
}
export async function withGithub<T>(env: Env, pair: Pair, fn: (capability: GitCapability) => Promise<T>): Promise<T> {
	const token = await installationToken(env, pair.installationId, pair.githubRepositoryId);
	try {
		const repo = await githubApi<GithubRepository>(token, `/repositories/${pair.githubRepositoryId}`);
		if (
			repo.id !== pair.githubRepositoryId ||
			!githubName(repo.owner.login) ||
			!githubName(repo.name) ||
			repo.archived ||
			repo.disabled ||
			repo.default_branch !== "main"
		)
			throw new IntakeError(409, "A writable GitHub main repository is required");
		return await fn({
			name: `github:${repo.id}`,
			remote: `https://github.com/${repo.owner.login}/${repo.name}.git`,
			token,
			authorization: `Basic ${btoa(`x-access-token:${token}`)}`,
		});
	} finally {
		const response = await fetch("https://api.github.com/installation/token", {
			method: "DELETE",
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "Quest-GitHub-App",
				"X-GitHub-Api-Version": "2026-03-10",
			},
		});
		if (!response.ok) throw new Error("GitHub token revocation failed");
	}
}
export async function verifyGithubMaintainer(
	env: Env,
	userId: string,
	installationId: number,
	repositoryId: number,
): Promise<GithubRepository> {
	const account = await env.DB.prepare(
		"SELECT accountId FROM account WHERE userId=? AND providerId='github' ORDER BY accountId LIMIT 1",
	)
		.bind(userId)
		.first<{ accountId: string }>();
	if (!account || !/^\d+$/.test(account.accountId))
		throw new IntakeError(403, "Linked GitHub maintainer identity required");
	const token = await installationToken(env, installationId, repositoryId);
	try {
		const user = await githubApi<{ id: number; login: string }>(token, `/user/${account.accountId}`);
		if (String(user.id) !== account.accountId || !githubName(user.login))
			throw new IntakeError(403, "GitHub identity mismatch");
		const repo = await githubApi<GithubRepository>(token, `/repositories/${repositoryId}`);
		if (
			repo.id !== repositoryId ||
			!githubName(repo.owner.login) ||
			!githubName(repo.name) ||
			repo.default_branch !== "main" ||
			repo.archived ||
			repo.disabled
		)
			throw new IntakeError(409, "A writable GitHub main repository is required");
		const permission = await githubApi<{ permission: string; user: { id: number } }>(
			token,
			`/repos/${repo.owner.login}/${repo.name}/collaborators/${user.login}/permission`,
		);
		if (permission.permission !== "admin" || String(permission.user.id) !== account.accountId)
			throw new IntakeError(403, "GitHub repository administrator required");
		return repo;
	} finally {
		const response = await fetch("https://api.github.com/installation/token", {
			method: "DELETE",
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "Quest-GitHub-App",
				"X-GitHub-Api-Version": "2026-03-10",
			},
		});
		if (!response.ok) throw new Error("GitHub token revocation failed");
	}
}
