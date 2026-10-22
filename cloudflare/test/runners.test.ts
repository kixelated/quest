import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import * as store from "../src/jobs/store";
import { identity, oauth, origin } from "./login-fixtures";

const db = env.DB;

let cookie = "";
let owner = "";

beforeEach(async () => {
	await db.prepare("DELETE FROM runners").run();
	const who = identity("github");
	cookie = (await oauth(who)).session!;
	owner = (await db
		.prepare("SELECT userId FROM account WHERE providerId='github' AND accountId=?")
		.bind(who.id)
		.first<{ userId: string }>())!.userId;
});

const token = "t".repeat(43);
const key = async () => store.digest(token);

function get(path: string, headers: Record<string, string> = { Cookie: cookie }) {
	return app.request(`${origin}${path}`, { headers, redirect: "manual" }, env);
}
function post(path: string, form: Record<string, string>, headers: Record<string, string> = {}) {
	return app.request(
		`${origin}${path}`,
		{
			method: "POST",
			headers: { Cookie: cookie, Origin: origin, ...headers },
			body: new URLSearchParams(form),
			redirect: "manual",
		},
		env,
	);
}
const whoami = () => app.request(`${origin}/api/runner`, { headers: { Authorization: `Bearer ${token}` } }, env);

describe("runner login", () => {
	it("connects a machine by the hash of the token it keeps", async () => {
		expect((await whoami()).status).toBe(401);
		const link = `/runners?${new URLSearchParams({ name: "laptop", platform: "darwin", key: await key() })}`;
		// Signed out, the link survives sign-in.
		const out = await get(link, {});
		expect(out.status).toBe(303);
		expect(new URL(out.headers.get("location")!, origin).searchParams.get("next")).toBe(link);
		const page = await (await get(link)).text();
		expect(page).toContain("Connect laptop");
		expect(page).toContain(`value="${await key()}"`);

		const form = { name: "laptop", platform: "darwin", key: await key() };
		expect((await post("/runners/connect", form, { Origin: "https://evil.example" })).status).toBe(403);
		const connected = await post("/runners/connect", form);
		expect(connected.status).toBe(303);
		expect(connected.headers.get("location")).toBe("/runners?connected=laptop");
		// Approving the same link twice keeps one runner.
		expect((await post("/runners/connect", form)).status).toBe(303);
		const { results } = await db.prepare("SELECT owner,name,platform,vm FROM runners").all();
		expect(results).toEqual([{ owner, name: "laptop", platform: "darwin", vm: 0 }]);

		const me = await whoami();
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({ name: "laptop", platform: "darwin", vm: false });
	});

	it("refuses a key another account already connected", async () => {
		await db
			.prepare("INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)")
			.bind("someone", "someone", "someone@example.test")
			.run();
		await store.registerRunner(db, "someone", "theirs", "linux", false, await key(), 0);
		const refused = await post("/runners/connect", { name: "mine", platform: "linux", key: await key() });
		expect(refused.status).toBe(409);
		expect(await refused.text()).toContain("already connected to another account");
	});

	it("rejects malformed connect requests", async () => {
		const bad = await post("/runners/connect", { name: "x", platform: "windows", key: await key() });
		expect(bad.status).toBe(409);
		const page = await (
			await get(`/runners?${new URLSearchParams({ name: "x", platform: "linux", key: "nope" })}`)
		).text();
		expect(page).not.toContain("Connect x");
	});
});

describe("account preference", () => {
	it("lists accounts across runners in preference order and reorders them", async () => {
		const a = await store.createRunner(db, owner, "alpha", "linux", false, 0);
		const b = await store.createRunner(db, owner, "beta", "darwin", false, 0);
		const runner = (id: string, name: string) => ({ id, owner, name, platform: "linux" as const, vm: 0 });
		const account = (id: string) => ({
			id,
			provider: "anthropic",
			kind: "subscription" as const,
			label: id,
			limited: false,
		});
		await store.report(db, runner(a.id, "alpha"), [account("first")], [], 0);
		await store.report(db, runner(b.id, "beta"), [account("second"), account("third")], [], 0);
		const order = async () => {
			const html = await (await get("/runners")).text();
			return ["first", "second", "third"].sort((x, y) => html.indexOf(`>${x}<`) - html.indexOf(`>${y}<`));
		};
		expect(await order()).toEqual(["first", "second", "third"]);
		expect((await post("/runners/accounts", { runner: b.id, account: "third", move: "up" })).status).toBe(303);
		expect(await order()).toEqual(["first", "third", "second"]);
		expect((await post("/runners/accounts", { runner: a.id, account: "first", move: "down" })).status).toBe(303);
		expect(await order()).toEqual(["third", "first", "second"]);
		// The ends stay put, and another owner's account is not found.
		expect((await post("/runners/accounts", { runner: b.id, account: "third", move: "up" })).status).toBe(303);
		expect(await order()).toEqual(["third", "first", "second"]);
		expect((await post("/runners/accounts", { runner: "missing", account: "first", move: "up" })).status).toBe(409);
		expect(
			(await post("/runners/accounts", { runner: a.id, account: "first", move: "up" }, { Origin: "" })).status,
		).toBe(403);
		const html = await (await get("/runners")).text();
		expect(html).toContain("alpha");
		expect(html).toContain("Offline");
	});
});
