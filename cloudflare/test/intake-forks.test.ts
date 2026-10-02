import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forkName, ownedFork, provisionFork } from "../src/intake/forks";
import { withCapability } from "../src/intake/registry";
import { contributor, owner, services, seed, FixtureRepo } from "./intake-fixtures";

beforeEach(async () => {
	await seed();
	await env.DB.prepare("DELETE FROM forks").run();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function setup() {
	const fake = services();
	const fork = vi.fn(async (name: string) => {
		const repo = new FixtureRepo(name);
		fake.repos.set(name, repo);
		return { remote: (await repo.info()).remote, token: "initial-token" };
	});
	Object.assign(fake.upstream, { fork });
	const subscription = {
		id: "subscribed",
		name: "",
		enabled: true,
		source: { type: "artifacts.repo", namespace: "quest", repo_name: "" },
		destination: { type: "queues.queue", queue_id: "d".repeat(32) },
		events: ["cf.artifacts.repo.pushed"],
	};
	let registered: typeof subscription | null = null;
	const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
		if (init?.method === "POST") registered = { ...subscription, ...JSON.parse(String(init.body)) };
		return Response.json({
			success: true,
			result: init?.method === "POST" ? registered : registered ? [registered] : [],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	return { ...fake, fork, fetcher };
}
describe("trusted fork provisioning and token capability boundaries", () => {
	it("copies only main, revokes initial credentials, subscribes once, and returns a ready owned fork", async () => {
		const fake = setup();
		const first = await provisionFork(fake.mockEnv, "upstream", contributor);
		expect(first.subscriptionId).toBe("subscribed");
		expect(fake.fork).toHaveBeenCalledWith(await forkName("upstream", contributor.userId), {
			defaultBranchOnly: true,
			readOnly: false,
		});
		const repo = fake.repos.get(first.forkName)!;
		expect(repo.revokeToken).toHaveBeenCalledWith("initial-token");
		expect(await ownedFork(fake.mockEnv, "upstream", contributor)).toEqual(first);
		expect(await provisionFork(fake.mockEnv, "upstream", contributor)).toEqual(first);
		expect(fake.fork).toHaveBeenCalledTimes(1);
		expect(fake.fetcher).toHaveBeenCalledTimes(2);
		await expect(ownedFork(fake.mockEnv, "upstream", owner)).rejects.toThrow("Create your fork");
		expect(await forkName("other", contributor.userId)).not.toBe(first.forkName);
	});
	it("withholds every token capability while subscription fails, then resumes the existing reserved fork", async () => {
		const fake = setup();
		fake.fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
		await expect(provisionFork(fake.mockEnv, "upstream", contributor)).rejects.toThrow(
			"subscription request failed",
		);
		await expect(ownedFork(fake.mockEnv, "upstream", contributor)).rejects.toThrow("Create your fork");
		expect((await provisionFork(fake.mockEnv, "upstream", contributor)).subscriptionId).toBe("subscribed");
		expect(fake.fork).toHaveBeenCalledTimes(1);
	});
	it("recovers an unreturned fork creation without stealing an unrelated reserved repository", async () => {
		const fake = setup();
		fake.fork.mockImplementationOnce(async (name) => {
			fake.repos.set(name, new FixtureRepo(name));
			throw new Error("Lost fork response");
		});
		await expect(provisionFork(fake.mockEnv, "upstream", contributor)).rejects.toThrow("Lost fork response");
		const name = await forkName("upstream", contributor.userId),
			repo = fake.repos.get(name)!;
		repo.listTokens.mockResolvedValueOnce({ total: 1, tokens: [{ id: "abandoned" }] as never[] });
		expect((await provisionFork(fake.mockEnv, "upstream", contributor)).forkName).toBe(name);
		expect(repo.revokeToken).toHaveBeenCalledWith("abandoned");
		expect(fake.fork).toHaveBeenCalledTimes(1);
	});
	it("revokes short-lived upstream tokens even when the Git operation fails", async () => {
		const fake = setup();
		await expect(
			withCapability(fake.mockEnv, "upstream", "write", async (cap) => {
				expect(cap).toEqual({
					name: "upstream",
					remote: "https://artifacts.example/upstream.git",
					token: "fixture-token",
				});
				throw new Error("Git failed");
			}),
		).rejects.toThrow("Git failed");
		expect(fake.upstream.createToken).toHaveBeenCalledWith("write", 300);
		expect(fake.upstream.revokeToken).toHaveBeenCalledTimes(1);
	});
});
