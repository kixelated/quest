import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventKey } from "../src/intake/events";
import { consumePushes } from "../src/intake/queue";
import { boundedText } from "../src/intake/subscriptions";
import {
	contributor,
	owner,
	original,
	claimed,
	base,
	pushed,
	event,
	services,
	seed,
	FixtureRepo,
} from "./intake-fixtures";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => seed());

describe("intake coordinator", () => {
	it("lands and credits a claim, deduplicates, persists ownership and schedules expiry", async () => {
		const fake = services(),
			stub = env.REPOSITORIES.getByName("intake-one");
		await runInDurableObject(stub, async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			const first = await object.ingest(event());
			expect(first.status).toBe("landed");
			expect(await object.ingest(event())).toEqual(first);
			expect(fake.applyMutation).toHaveBeenCalledTimes(1);
			expect(fake.applyMutation.mock.calls[0][1].author.name).toContain("[github:1234]");
			expect(fake.applyMutation.mock.calls[0][1].author.email).toMatch(/^[a-f0-9]{64}@users.quest.invalid$/);
			expect(fake.applyMutation.mock.calls[0][1].author.email).not.toBe(contributor.email);
			expect(fake.upstream.commits.get(fake.upstream.head)!.files["quest/one.md"]).toBe(claimed());
			expect(state.storage.sql.exec("SELECT forkName FROM claims").one()).toEqual({
				forkName: contributor.forkName,
			});
			expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);
			expect(fake.upstream.revokeToken).toHaveBeenCalledTimes(1);
		});
	});
	it("restores expiry bookkeeping after push success, lost response, and DO eviction", async () => {
		const fake = services(),
			stub = env.REPOSITORIES.getByName("intake-lost");
		fake.loseResponse();
		await runInDurableObject(stub, async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			await expect(object.ingest(event())).rejects.toThrow("Response lost");
			expect(state.storage.sql.exec("SELECT * FROM claims").toArray()).toEqual([]);
			expect(
				state.storage.sql
					.exec<{ payload: string }>("SELECT payload FROM operations WHERE id=?", eventKey(event()))
					.one().payload,
			).toContain("unclaimedContent");
		});
		await evictDurableObject(stub);
		await runInDurableObject(stub, async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			expect((await object.ingest(event())).status).toBe("landed");
			expect(state.storage.sql.exec("SELECT forkName FROM claims").one()).toEqual({
				forkName: contributor.forkName,
			});
			expect(await state.storage.getAlarm()).not.toBeNull();
		});
	});
	it("serializes concurrent claimants so only one wins", async () => {
		const second = {
			...contributor,
			userId: "other",
			identity: "999",
			name: "Other",
			email: "other@example.com",
			forkName: "fork-other",
			remote: "https://artifacts.example/fork-other.git",
			subscriptionId: "other-subscription",
		};
		await seed([second]);
		const fake = services(),
			source = new FixtureRepo(second.forkName);
		source.add("d".repeat(40), { ...source.commits.get(base)!.files, "quest/one.md": claimed(second) });
		fake.repos.set(second.forkName, source);
		await runInDurableObject(env.REPOSITORIES.getByName("intake-race"), async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			const result = await Promise.all([
				object.ingest(event()),
				object.ingest(event(second, base, "d".repeat(40))),
			]);
			expect(result.map((r) => r.status)).toEqual(["landed", "ignored"]);
			expect(fake.applyMutation).toHaveBeenCalledTimes(1);
			expect(state.storage.sql.exec("SELECT * FROM claims").toArray()).toHaveLength(1);
		});
	});
	it("re-gates a pre-push failure after unrelated upstream progress", async () => {
		const fake = services();
		fake.failBeforePush();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-replan"), async (object) => {
			Object.assign(object, { env: fake.mockEnv });
			await expect(object.ingest(event())).rejects.toThrow("before push");
			fake.upstream.add("e".repeat(40), {
				...fake.upstream.commits.get(base)!.files,
				"README.md": "Other progress\n",
			});
			expect((await object.ingest(event())).status).toBe("landed");
			expect(fake.applyMutation.mock.calls.at(-1)![1].expectedHead).toBe("e".repeat(40));
		});
	});
	it("terminates a pending attempt when another claimant wins", async () => {
		const fake = services();
		fake.failBeforePush();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-occupied"), async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			await expect(object.ingest(event())).rejects.toThrow("before push");
			fake.upstream.add("e".repeat(40), {
				...fake.upstream.commits.get(base)!.files,
				"quest/one.md": claimed({ ...contributor, identity: "different" }),
			});
			expect(await object.ingest(event())).toEqual({ status: "ignored" });
			expect(await object.ingest(event())).toEqual({ status: "ignored" });
			expect(state.storage.sql.exec<{ result: string }>("SELECT result FROM operations").one().result).toContain(
				"ignored",
			);
			expect(fake.applyMutation).toHaveBeenCalledTimes(2);
		});
	});
	it("rejects force-pushed history, invalid UTF-8, and wrong subscription identity", async () => {
		const fake = services();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-invalid"), async (object) => {
			Object.assign(object, { env: fake.mockEnv });
			const spoof = event();
			spoof.metadata.eventSubscriptionId = "forged";
			expect((await object.ingest(spoof)).status).toBe("ignored");
			fake.source.commits.get(pushed)!.parents = [];
			expect((await object.ingest(event())).status).toBe("ignored");
			fake.source.add(
				"f".repeat(40),
				{ ...fake.source.commits.get(base)!.files, "issues/invalid.md": new Uint8Array([0xff]) },
				[base],
			);
			expect((await object.ingest(event(contributor, base, "f".repeat(40)))).status).toBe("ignored");
			expect(fake.applyMutation).not.toHaveBeenCalled();
		});
	});
	it("does not shorten leases for delayed pushes or expire freshly renewed activity", async () => {
		const fake = services();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-renew"), async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			await object.ingest(event());
			const later = Date.now() + 49 * 60 * 60 * 1000;
			vi.spyOn(Date, "now").mockReturnValue(later);
			fake.source.lastPushAt = later - 1000;
			await object.alarm();
			expect(state.storage.sql.exec("SELECT * FROM claims").toArray()).toHaveLength(1);
			fake.source.lastPushAt = later - 48 * 60 * 60 * 1000;
			const old = event();
			old.metadata.eventTimestamp = new Date(0).toISOString();
			await object.ingest(old);
			const row = await env.DB.prepare("SELECT lastPushAt FROM forks WHERE forkName=?")
				.bind(contributor.forkName)
				.first<{ lastPushAt: number }>();
			expect(row!.lastPushAt).toBe(later - 1000);
		});
	});
	it("expires unchanged claims at 48h, preserves original bytes, and authorizes release", async () => {
		const fake = services();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-expire"), async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			await object.ingest(event());
			await expect(object.release("upstream", "quest/one.md", contributor.userId)).rejects.toThrow("Maintainer");
			vi.spyOn(Date, "now").mockReturnValue(Date.now() + 49 * 60 * 60 * 1000);
			await object.alarm();
			expect(fake.upstream.commits.get(fake.upstream.head)!.files["quest/one.md"]).toBe(original);
			expect(state.storage.sql.exec("SELECT * FROM claims").toArray()).toEqual([]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});
	it("does not expire a claim that has been reassigned since it was tracked", async () => {
		const fake = services();
		await runInDurableObject(env.REPOSITORIES.getByName("intake-reassigned"), async (object, state) => {
			Object.assign(object, { env: fake.mockEnv });
			await object.ingest(event());
			fake.upstream.add("e".repeat(40), {
				...fake.upstream.commits.get(fake.upstream.head)!.files,
				"quest/one.md": claimed({ ...contributor, identity: "other" }),
			});
			vi.spyOn(Date, "now").mockReturnValue(Date.now() + 49 * 60 * 60 * 1000);
			await object.alarm();
			expect(fake.applyMutation).toHaveBeenCalledTimes(1);
			expect(state.storage.sql.exec("SELECT * FROM claims").toArray()).toEqual([]);
		});
	});
	it("registers quarantine before exposing a repository; preserves pending registration on a lost response", async () => {
		await env.DB.prepare("DELETE FROM forks").run();
		await env.DB.prepare("DELETE FROM repositories").run();
		const fake = services();
		fake.loseResponse();
		await runInDurableObject(env.REPOSITORIES.getByName("registration"), async (object) => {
			Object.assign(object, { env: fake.mockEnv });
			await expect(object.register("upstream", owner)).rejects.toThrow("Response lost");
			expect(await env.DB.prepare("SELECT * FROM repositories").all()).toMatchObject({ results: [] });
			expect((await object.register("upstream", owner)).status).toBe("landed");
			expect(fake.upstream.commits.get(fake.upstream.head)!.files[".codex/hooks.json"]).toContain("PreToolUse");
			await expect(object.register("upstream", contributor)).rejects.toThrow("Operator");
		});
	});
});

describe("Queue and HTTP intake boundaries", () => {
	it("acknowledges ignored messages and retries provider failures", async () => {
		const ack = vi.fn(),
			retry = vi.fn(),
			good = event(),
			fake = services();
		const failed = {
			...fake.mockEnv,
			REPOSITORIES: {
				getByName: () => ({
					ingest: async () => {
						throw new Error("Service unavailable");
					},
				}),
			},
		} as unknown as Env;
		await consumePushes(
			{
				messages: [
					{ body: { type: "invalid" }, ack, retry },
					{ body: good, ack, retry },
				],
			} as unknown as MessageBatch,
			failed,
		);
		expect(ack).toHaveBeenCalledTimes(1);
		expect(retry).toHaveBeenCalledTimes(1);
	});
	it("requires a session and same-origin writes", async () => {
		for (const path of [
			"/repositories/upstream/fork",
			"/repositories/upstream/tokens",
			"/repositories/upstream/release",
		]) {
			expect(
				(
					await SELF.fetch("http://localhost:8787" + path, {
						method: "POST",
						headers: { Origin: "http://localhost:8787" },
					})
				).status,
			).toBe(401);
			expect(
				(
					await SELF.fetch("http://localhost:8787" + path, {
						method: "POST",
						headers: { Origin: "https://attacker.example" },
					})
				).status,
			).toBe(403);
		}
		expect((await SELF.fetch("http://localhost:8787/repositories")).status).toBe(401);
	});
	it("preserves BOM source bytes rather than silently rewriting them", async () => {
		expect(await boundedText(new Blob(["\uFEFF# Text\n"]), 100)).toBe("\uFEFF# Text\n");
	});
});
