import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { GitHubService } from "../src/github/service";
import { privateKey } from "./github-key";
import { identity, oauth, origin } from "./login-fixtures";

const testEnv = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey };
const repo = { owner: "upstream", name: "project", id: 10 };
const commit = "a".repeat(40);
const tree = "b".repeat(40);
const documents = [
	{
		path: "quest/README.md",
		content:
			"# Project\n\n## Goal\n\nBuild it.\n\n## Required\n\n- [First](/quest/first.md)\n- [Second](/quest/second.md)\n",
	},
	{ path: "quest/first.md", content: "# [S] First\n\n## Goal\n\nBuild first.\n" },
	{
		path: "quest/second.md",
		content: "# [M] Second\n\n## Goal\n\nBuild second.\n\n## Required\n\n- [First](/quest/first.md)\n",
	},
];

function github(
	options: {
		role?: string;
		account?: number;
		private?: boolean;
		missing?: boolean;
		suspended?: boolean;
		id?: number;
		truncated?: boolean;
		noQuests?: boolean;
		invalid?: boolean;
		symlink?: boolean;
		license?: string | null;
		changedLicense?: string | null;
		approval?: boolean[];
		licenseData?: unknown;
		licenseStatus?: number;
		licenseFails?: boolean;
		onLicenseRead?: () => void;
	} = {},
) {
	let repositoryReads = 0;
	let licenseReads = 0;
	const calls: { path: string; method: string; body: any; authorization: string | null }[] = [];
	const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const path = url.pathname;
		calls.push({
			path: path + url.search,
			method: init?.method ?? "GET",
			body: init?.body && JSON.parse(String(init.body)),
			authorization: new Headers(init?.headers).get("Authorization"),
		});
		if (url.hostname === "spdx.org") {
			licenseReads++;
			options.onLicenseRead?.();
			if (options.licenseFails) throw new TypeError("Network unavailable");
			const licenseId = decodeURIComponent(
				path
					.split("/")
					.at(-1)!
					.replace(/\.json$/, ""),
			);
			return Response.json(
				options.licenseData ?? {
					licenseId,
					isOsiApproved: options.approval?.[Math.min(licenseReads - 1, options.approval.length - 1)] ?? true,
				},
				{ status: options.licenseStatus ?? 200 },
			);
		}
		if (path === "/app") return Response.json({ id: 123, slug: "quest-test" });
		if (path.endsWith("/installation"))
			return Response.json(
				options.missing
					? {}
					: {
							id: 5,
							app_id: 123,
							suspended_at: options.suspended ? "2026-10-15" : null,
							permissions: { metadata: "read", contents: "read" },
						},
				{ status: options.missing ? 404 : 200 },
			);
		if (path.endsWith("/access_tokens")) return Response.json({ token: "installation-token" });
		if (path === "/installation/token") return new Response(null, { status: 204 });
		if (path === "/repos/upstream/project") {
			repositoryReads++;
			const detected =
				repositoryReads > 1 && options.changedLicense !== undefined
					? options.changedLicense
					: options.license === undefined
						? "MIT"
						: options.license;
			return Response.json({
				...repo,
				id: options.id ?? repo.id,
				owner: { login: repo.owner },
				private: options.private ?? false,
				visibility: options.private ? "private" : "public",
				default_branch: "trunk",
				archived: false,
				disabled: false,
				license: detected ? { spdx_id: detected, name: `${detected} License` } : null,
			});
		}
		if (path.startsWith("/user/"))
			return Response.json({ id: Number(path.split("/").at(-1)), login: "maintainer" });
		if (path.endsWith("/permission")) {
			return Response.json({
				user: { id: options.account ?? 7007 },
				permission: options.role === "admin" ? "admin" : "write",
				role_name: options.role ?? "maintain",
			});
		}
		if (path === "/repos/upstream/project/commits/trunk")
			return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
		if (path === `/repos/upstream/project/git/trees/${tree}`)
			return Response.json({
				truncated: options.truncated ?? false,
				tree: options.noQuests
					? []
					: [
							{ path: "quest", type: "tree", mode: "040000", sha: "c".repeat(40) },
							...documents.map((doc, i) => ({
								path: doc.path,
								type: "blob",
								mode: options.symlink ? "120000" : "100644",
								sha: String(i + 1).repeat(40),
							})),
						],
			});
		if (path.includes("/git/blobs/")) {
			const index = Number(path.split("/").at(-1)![0]) - 1;
			return Response.json({
				encoding: "base64",
				content: Buffer.from(
					options.invalid && index === 1 ? "# Bad quest" : documents[index].content,
				).toString("base64"),
			});
		}
		throw new Error(`Unexpected GitHub request ${path}`);
	});
	return { calls, request, service: new GitHubService(testEnv, request as typeof fetch) };
}

async function state() {
	return env.DB.prepare("SELECT * FROM github_projects WHERE id=10").first<{ state: string }>();
}

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM github_projects"),
		env.DB.prepare("DELETE FROM github_installations"),
		env.DB.prepare(
			"INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('enrollment-test','Maintainer','enrollment-test@example.test',1,0,0)",
		),
		env.DB.prepare(
			"INSERT OR IGNORE INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('enrollment-account','7007','github','enrollment-test',0,0)",
		),
		env.DB.prepare("UPDATE account SET accountId='7007' WHERE userId='enrollment-test'"),
	]);
});
afterEach(() => vi.restoreAllMocks());

describe("project enrollment", () => {
	it("keeps App installation and read-only default-branch preview separate from opt-in", async () => {
		const { service, calls } = github();
		expect(await service.installationURL()).toBe("https://github.com/apps/quest-test/installations/new");
		expect(await service.resolveRepository(repo.owner, repo.name)).toEqual(repo);
		expect(await service.previewProject(repo, "enrollment-test")).toMatchObject({
			commit,
			branch: "trunk",
			state: null,
			quests: [{ path: "quest/first.md", title: "[S] First" }],
		});
		expect(await state()).toBeNull();
		expect(calls.find((call) => call.path === "/repos/upstream/project")?.authorization).toBeNull();
		expect(calls.find((call) => call.path.endsWith("/access_tokens"))?.body).toEqual({
			repository_ids: [10],
			permissions: { metadata: "read", contents: "read" },
		});
		expect(calls.some((call) => call.path === `/repos/upstream/project/git/trees/${tree}?recursive=1`)).toBe(true);
		expect(calls.at(-1)?.path).toBe("/installation/token");
	});
	it.each(["MIT", "Apache-2.0", "GPL-3.0"])("enrolls GitHub-detected OSI-approved %s licensing", async (license) => {
		const { service, calls } = github({ license });
		await service.setContributions(repo, "enrollment-test", "enabled");
		expect(await state()).toMatchObject({ state: "enabled" });
		const lookups = calls.filter((call) => call.path === `/licenses/${license}.json`);
		expect(lookups).toHaveLength(2);
		expect(lookups.every((call) => call.authorization === null)).toBe(true);
	});
	it.each([
		{ license: null },
		{ license: "NOASSERTION" },
		{ license: "LicenseRef-custom", licenseStatus: 404 },
		{ license: "BUSL-1.1", approval: [false] },
		{ license: "MIT", licenseData: { licenseId: "Apache-2.0", isOsiApproved: true } },
	])("rejects unsupported or unmatched detected licenses: %j", async (options) => {
		const { service } = github(options);
		expect((await service.previewProject(repo, "enrollment-test")).licenseError).toContain(
			"GitHub must detect an OSI-approved license",
		);
		await expect(service.setContributions(repo, "enrollment-test", "enabled")).rejects.toThrow(
			"OSI-approved license",
		);
		expect(await state()).toBeNull();
	});
	it.each([
		{ licenseStatus: 503 },
		{ licenseFails: true },
		{ licenseData: {} },
		{ licenseData: { licenseId: "MIT", isOsiApproved: "true" } },
	])("fails closed when approval metadata is unavailable or invalid: %j", async (options) => {
		await expect(github(options).service.setContributions(repo, "enrollment-test", "enabled")).rejects.toThrow(
			"could not be verified",
		);
		expect(await state()).toBeNull();
	});
	it("rejects changes to the detected license and revoked OSI approval during opt-in", async () => {
		await expect(
			github({ changedLicense: "BUSL-1.1" }).service.setContributions(repo, "enrollment-test", "enabled"),
		).rejects.toThrow("eligibility changed");
		await expect(
			github({ approval: [true, false] }).service.setContributions(repo, "enrollment-test", "enabled"),
		).rejects.toThrow("OSI-approved license");
		expect(await state()).toBeNull();
	});
	it("rechecks licensing and OSI approval on resume instead of reusing enrollment eligibility", async () => {
		await github().service.setContributions(repo, "enrollment-test", "enabled");
		await github().service.setContributions(repo, "enrollment-test", "paused");
		for (const options of [{ license: null }, { license: "BUSL-1.1", approval: [false] }, { approval: [false] }]) {
			await expect(github(options).service.setContributions(repo, "enrollment-test", "enabled")).rejects.toThrow(
				"OSI-approved license",
			);
			expect(await state()).toMatchObject({ state: "paused" });
		}
	});
	it("persists explicit opt-in, pauses new work, resumes only through eligibility, and disconnects", async () => {
		const { service, calls } = github();
		await service.setContributions(repo, "enrollment-test", "enabled");
		expect(await state()).toMatchObject({ state: "enabled" });
		expect(await service.projects("enrollment-test")).toEqual([{ ...repo, state: "enabled" }]);
		await service.setContributions(repo, "enrollment-test", "paused");
		expect(await state()).toMatchObject({ state: "paused" });
		await service.setContributions(repo, "enrollment-test", "enabled");
		expect(await service.previewProject(repo, "enrollment-test")).toMatchObject({ state: "enabled" });
		await service.setContributions(repo, "enrollment-test", "disconnected");
		expect(await state()).toBeNull();
		expect(calls.filter((call) => call.path.endsWith("/permission"))).toHaveLength(7);
		expect(
			calls
				.filter((call) => call.method !== "GET")
				.every((call) => call.path.endsWith("/access_tokens") || call.path === "/installation/token"),
		).toBe(true);
	});
	it("can pause and disconnect even after Quest files disappear or the project becomes private", async () => {
		await github().service.setContributions(repo, "enrollment-test", "enabled");
		const { service, calls } = github({ noQuests: true, private: true });
		await service.setContributions(repo, "enrollment-test", "paused");
		expect(await state()).toMatchObject({ state: "paused" });
		await service.setContributions(repo, "enrollment-test", "disconnected");
		expect(await state()).toBeNull();
		expect(calls.some((call) => call.path.includes("/git/"))).toBe(false);
	});
	it.each(["write", "triage", "custom-writer"])("rejects %s authority on every control", async (role) => {
		for (const change of ["enabled", "paused", "disconnected"] as const)
			await expect(github({ role }).service.setContributions(repo, "enrollment-test", change)).rejects.toThrow(
				"maintainer authority",
			);
		expect(await state()).toBeNull();
	});
	it.each([
		[{ missing: true }, "404"],
		[{ suspended: true }, "unavailable"],
		[{ id: 99 }, "identity"],
		[{ private: true }, "public"],
		[{ truncated: true }, "incomplete"],
		[{ noQuests: true }, "setup guide"],
		[{ invalid: true }, "quest check"],
		[{ symlink: true }, "regular files"],
	] as const)("rejects unavailable or ineligible snapshots: %j", async (options, message) => {
		await expect(github(options).service.setContributions(repo, "enrollment-test", "enabled")).rejects.toThrow(
			message,
		);
		expect(await state()).toBeNull();
	});
	it("rechecks authority after snapshot and eligibility checks before saving opt-in", async () => {
		const options = {
			role: "maintain",
			onLicenseRead: () => {
				options.role = "write";
			},
		};
		await expect(github(options).service.setContributions(repo, "enrollment-test", "enabled")).rejects.toThrow(
			"maintainer authority",
		);
		expect(await state()).toBeNull();
	});
	it("does not trust the enrollment record as authority after role revocation", async () => {
		await github().service.setContributions(repo, "enrollment-test", "enabled");
		await expect(
			github({ role: "write" }).service.setContributions(repo, "enrollment-test", "disconnected"),
		).rejects.toThrow("maintainer authority");
		expect(await state()).toMatchObject({ state: "enabled" });
	});
});

describe("project setup routes", () => {
	it("requires a session and same-origin posts, validates choices before provider requests", async () => {
		expect((await app.request(`${origin}/projects`, undefined, testEnv)).headers.get("location")).toBe(
			"/sign-in?next=/projects",
		);
		const input = { method: "POST", body: new URLSearchParams({ id: "10", state: "enabled" }) };
		expect((await app.request(`${origin}/projects/github/upstream/project`, input, testEnv)).status).toBe(403);
		expect(
			(
				await app.request(
					`${origin}/projects/github/upstream/project`,
					{ ...input, headers: { Origin: origin } },
					testEnv,
				)
			).status,
		).toBe(401);
		expect(
			(await app.request(`${origin}/projects/select?repository=//evil.example`, undefined, testEnv)).headers.get(
				"location",
			),
		).toBe("/projects?error=repository");
	});
	it("disables opt-in for unapproved licensing and rejects a forged enable form", async () => {
		const who = identity("github");
		const { session } = await oauth(who);
		const { request } = github({ account: Number(who.id), license: "BUSL-1.1", approval: [false, false] });
		vi.spyOn(globalThis, "fetch").mockImplementation(request as typeof fetch);
		const response = await app.request(
			`${origin}/projects/github/upstream/project`,
			{ headers: { Cookie: session! } },
			testEnv,
		);
		const html = await response.text();
		expect(html).toContain("disabled");
		expect(html).toContain("GitHub must detect an OSI-approved license");
		const posted = await app.request(
			`${origin}/projects/github/upstream/project`,
			{
				method: "POST",
				headers: { Cookie: session!, Origin: origin },
				body: new URLSearchParams({ id: "10", state: "enabled" }),
			},
			testEnv,
		);
		expect(posted.status).toBe(403);
		expect(await state()).toBeNull();
	});
	it("renders ready quests in the existing visual system and enables eligible repositories through authenticated forms", async () => {
		const who = identity("github");
		const { session } = await oauth(who);
		// The fixture verifies the actual linked account supplied by this session.
		const { request } = github({ account: Number(who.id) });
		vi.spyOn(globalThis, "fetch").mockImplementation(request as typeof fetch);
		const response = await app.request(
			`${origin}/projects/github/upstream/project`,
			{ headers: { Cookie: session! } },
			testEnv,
		);
		expect(response.status).toBe(200);
		const html = await response.text();
		for (const content of [
			"/theme/theme.css",
			"ql-panel panel",
			"Ready quests",
			"First",
			"trunk",
			"no second approval flag",
			"OSI-approved license",
		])
			expect(html).toContain(content);
		expect(html).not.toContain(">Second<");
		expect(html).not.toContain("disabled");
		const posted = await app.request(
			`${origin}/projects/github/upstream/project`,
			{
				method: "POST",
				headers: { Cookie: session!, Origin: origin },
				body: new URLSearchParams({ id: "10", state: "enabled" }),
			},
			testEnv,
		);
		expect(posted.status).toBe(303);
		expect(await state()).toMatchObject({ state: "enabled" });
		// Authenticated stop controls do not depend on readable Quest snapshots.
		const unavailable = github({ account: Number(who.id), noQuests: true, private: true });
		vi.mocked(globalThis.fetch).mockImplementation(unavailable.request as typeof fetch);
		for (const state of ["paused", "disconnected"]) {
			const stopped = await app.request(
				`${origin}/projects/github/upstream/project`,
				{
					method: "POST",
					headers: { Cookie: session!, Origin: origin },
					body: new URLSearchParams({ id: "10", state }),
				},
				testEnv,
			);
			expect(stopped.status).toBe(303);
		}
		expect(await state()).toBeNull();
	});
});
