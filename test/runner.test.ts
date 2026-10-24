import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { Claude, streamReader } from "../src/runner/claude";
import { devShell, login } from "../src/runner/cli";
import { Connection, type Socket, backoff } from "../src/runner/connection";
import { type Account, RunnerHome } from "../src/runner/home";
import { serveTools } from "../src/runner/mcp";
import { FLUSH_BYTES, OutputUploader, split } from "../src/runner/output";
import { formatAnswer, resumePrompt, startPrompt } from "../src/runner/prompt";
import type { Job } from "../src/runner/protocol";
import { Runner } from "../src/runner/runner";
import { Workspace } from "../src/runner/workspace";
import { tempDir } from "./fixture";

const posix = test.skipIf(process.platform === "win32");

function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.test",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.test",
		},
	}).trim();
}

/** An upstream repository with one commit, as a job's revision. */
function upstream(): { dir: string; commit: string } {
	const dir = join(tempDir(), "upstream");
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	writeFileSync(join(dir, "AGENTS.md"), "Always run the tests.\n");
	writeFileSync(join(dir, "flake.nix"), "{}\n");
	writeFileSync(join(dir, "old.txt"), "old\n");
	writeFileSync(join(dir, ".gitignore"), "ignored/\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "init");
	return { dir, commit: git(dir, "rev-parse", "HEAD") };
}

function job(revision: string, extra: Partial<Job> = {}): Job {
	return {
		id: "job1",
		attempt: 1,
		workflow: "start",
		target: "quest/m0/thing.md",
		revision,
		branch: "quest/m0/thing",
		trusted: 1,
		account: "acct1",
		session: null,
		head: null,
		pull: null,
		owner: "owner",
		name: "repo",
		events: [],
		questions: [],
		...extra,
	};
}

describe("raw output", () => {
	test("splits on character boundaries within the chunk limit", () => {
		const text = `${"a".repeat(5)}é${"b".repeat(3)}`;
		const pieces = split(text, 6);
		expect(pieces.join("")).toBe(text);
		for (const piece of pieces) expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(6);
		expect(pieces[0]).toBe("aaaaa");
	});

	test("numbers chunks contiguously and stops at the cap", async () => {
		const sent: [number, string][] = [];
		const uploader = new OutputUploader(
			async (seq, text) => {
				sent.push([seq, text]);
				return { truncated: seq === 1 };
			},
			() => {},
			4,
			60_000,
		);
		uploader.write("abcd");
		uploader.write("efgh");
		uploader.write("ijkl");
		await uploader.close();
		expect(sent).toEqual([
			[0, "abcd"],
			[1, "efgh"],
		]);
	});

	test("waits to batch small output", async () => {
		const sent: string[] = [];
		const uploader = new OutputUploader(
			async (_, text) => (sent.push(text), {}),
			() => {},
			1024,
			10,
		);
		uploader.write("a");
		uploader.write("b");
		expect(sent).toEqual([]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		await uploader.close();
		expect(sent).toEqual(["ab"]);
	});
});

class FakeSocket implements Socket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	closed = false;
	constructor(readonly hub: FakeHub) {}
	send(data: string) {
		if (!this.closed) this.hub.receive(this, JSON.parse(data));
	}
	close(code = 1000, reason = "") {
		if (this.closed) return;
		this.closed = true;
		setTimeout(() => this.onclose?.({ code, reason }), 0);
	}
	deliver(message: unknown) {
		if (!this.closed) this.onmessage?.({ data: JSON.stringify(message) });
	}
}

type Sent = Record<string, any>;

/** The hub's side of the protocol, replying as the Worker would by default. */
class FakeHub {
	sockets: FakeSocket[] = [];
	messages: Sent[] = [];
	/** The action a status reply gives each attempt, by `job.attempt`. */
	actions = new Map<string, string>();
	/** Messages to hold without replying, to simulate a lost reply. */
	hold: ((message: Sent) => boolean) | null = null;
	#waiters: { match: (m: Sent) => boolean; resolve: (m: Sent) => void }[] = [];

	dial = () => {
		const socket = new FakeSocket(this);
		this.sockets.push(socket);
		setTimeout(() => socket.onopen?.(), 0);
		return socket;
	};

	get socket() {
		return this.sockets.at(-1)!;
	}

	receive(socket: FakeSocket, message: Sent) {
		this.messages.push(message);
		for (const waiter of [...this.#waiters])
			if (waiter.match(message)) {
				this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
				waiter.resolve(message);
			}
		if (this.hold?.(message)) return;
		const reply =
			message.type === "status"
				? {
						attempts: message.attempts.map((a: Sent) => ({
							...a,
							action: this.actions.get(`${a.job}.${a.attempt}`) ?? "continue",
						})),
					}
				: message.type === "question"
					? { question: "q1", cancel: false }
					: message.type === "checkpoint"
						? { cancel: false }
						: {};
		setTimeout(() => socket.deliver({ type: "reply", id: message.id, ...reply }), 0);
	}

	/** The first message so far, or the next, that matches. */
	next(match: (m: Sent) => boolean): Promise<Sent> {
		const found = this.messages.find(match);
		if (found) return Promise.resolve(found);
		return new Promise((resolve) => this.#waiters.push({ match, resolve }));
	}

	of(type: string): Sent[] {
		return this.messages.filter((m) => m.type === type);
	}
}

describe("connection", () => {
	test("backs off from one second to a minute", () => {
		expect(backoff(0, () => 0.5)).toBe(1000);
		expect(backoff(3, () => 0.5)).toBe(8000);
		expect(backoff(20, () => 0.5)).toBe(60_000);
	});

	test("resends unanswered requests after reconnecting, after a fresh status", async () => {
		const hub = new FakeHub();
		const logs: string[] = [];
		let opens = 0;
		const connection: Connection = new Connection(
			"ws://kix.test",
			"token",
			{
				open: () => {
					opens++;
					void connection.request({ type: "status", accounts: [], attempts: [], slots: 1 });
				},
				push: () => {},
				replaced: () => {},
				log: (line) => logs.push(line),
			},
			hub.dial,
		);
		connection.start();
		await hub.next((m) => m.type === "status");
		hub.hold = (m) => m.type === "checkpoint";
		const reply = connection.request({ type: "checkpoint", job: "j", attempt: 1, summary: "s", session: null });
		await hub.next((m) => m.type === "checkpoint");
		hub.hold = null;
		hub.socket.close(1006, "lost");
		await expect(reply).resolves.toMatchObject({ cancel: false });
		expect(opens).toBe(2);
		const types = hub.messages.map((m) => m.type);
		expect(types).toEqual(["status", "checkpoint", "status", "checkpoint"]);
		// The retry is identical, id included, so the hub accepts it as one.
		const [first, second] = hub.of("checkpoint");
		expect(second).toEqual(first);
		connection.close();
	});

	test("reports a replaced connection instead of reconnecting", async () => {
		const hub = new FakeHub();
		let replaced = false;
		const connection = new Connection(
			"ws://kix.test",
			"token",
			{ open: () => {}, push: () => {}, replaced: () => (replaced = true), log: () => {} },
			hub.dial,
		);
		connection.start();
		await new Promise((resolve) => setTimeout(resolve, 5));
		hub.socket.close(4000, "Replaced by a new connection");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(replaced).toBe(true);
		expect(hub.sockets).toHaveLength(1);
	});
});

describe("workspace", () => {
	posix("publishes only what changed since the branch's head, by mode", async () => {
		const { dir, commit } = upstream();
		const root = tempDir();
		const workspace = await Workspace.prepare(root, job(commit), dir);
		expect(readFileSync(join(workspace.dir, "AGENTS.md"), "utf8")).toBe("Always run the tests.\n");
		writeFileSync(join(workspace.dir, "new.sh"), "#!/bin/sh\n");
		chmodSync(join(workspace.dir, "new.sh"), 0o755);
		symlinkSync("new.sh", join(workspace.dir, "link"));
		mkdirSync(join(workspace.dir, "ignored"));
		writeFileSync(join(workspace.dir, "ignored", "build.o"), "x");
		execFileSync("rm", [join(workspace.dir, "old.txt")]);
		const snapshot = await workspace.snapshot();
		expect(snapshot.changes).toEqual([
			{ path: "link", content: Buffer.from("new.sh").toString("base64"), symlink: true },
			{ path: "new.sh", content: Buffer.from("#!/bin/sh\n").toString("base64"), executable: true },
			{ path: "old.txt", content: null },
		]);
		await workspace.published("e".repeat(40), snapshot);
		expect(workspace.head).toBe("e".repeat(40));
		expect((await workspace.snapshot()).changes).toEqual([]);
		// The agent's own commits and index do not change what is published.
		writeFileSync(join(workspace.dir, "next.txt"), "next\n");
		git(workspace.dir, "add", "next.txt");
		git(workspace.dir, "commit", "-q", "-m", "local");
		expect((await workspace.snapshot()).changes.map((c) => c.path)).toEqual(["next.txt"]);

		// The next attempt reuses the checkout while the branch is where it left it.
		const again = await Workspace.prepare(root, job(commit, { attempt: 2, head: "e".repeat(40) }), dir);
		expect(existsSync(join(again.dir, "next.txt"))).toBe(true);
		await again.remove();
		expect(existsSync(again.dir)).toBe(false);
	});

	posix("prepares jobs on one repository at once without racing on its clone", async () => {
		const { dir, commit } = upstream();
		const root = tempDir();
		const jobs = ["a", "b", "c"].map((id) => job(commit, { id }));
		const workspaces = await Promise.all(jobs.map((j) => Workspace.prepare(root, j, dir)));
		for (const workspace of workspaces) expect(existsSync(join(workspace.dir, "AGENTS.md"))).toBe(true);
		await Promise.all(workspaces.map((workspace) => workspace.remove()));
		for (const workspace of workspaces) expect(existsSync(workspace.dir)).toBe(false);
	});
});

describe("Claude Code output", () => {
	test("reads limits from rate limit events, assistant errors, and results", () => {
		const event = streamReader();
		event.line(
			JSON.stringify({
				type: "rate_limit_event",
				rate_limit_info: { status: "rejected", resetsAt: 1_900_000_000 },
			}),
		);
		event.line(JSON.stringify({ type: "result", is_error: true, result: "limit" }));
		expect(event.exit(1, "")).toMatchObject({ limited: { until: 1_900_000_000_000 }, failed: true });

		const flagged = streamReader();
		flagged.line(JSON.stringify({ type: "assistant", error: "rate_limit" }));
		expect(flagged.exit(1, "").limited).toEqual({ until: null });

		const legacy = streamReader();
		legacy.line(
			JSON.stringify({ type: "result", is_error: true, result: "Claude AI usage limit reached|1900000000" }),
		);
		expect(legacy.exit(1, "").limited).toEqual({ until: 1_900_000_000_000 });

		const fine = streamReader();
		fine.line(JSON.stringify({ type: "result", is_error: false, result: "fixed the usage limit check" }));
		expect(fine.exit(0, "")).toEqual({ limited: null, failed: false, reply: "fixed the usage limit check" });

		const crashed = streamReader();
		expect(crashed.exit(1, "boom\n")).toEqual({ limited: null, failed: true, reply: "boom" });
	});
});

describe("kix tools", () => {
	test("speak MCP over HTTP to the attempt's agent only", async () => {
		const server = await serveTools([
			{
				name: "echo",
				description: "Echo",
				inputSchema: { type: "object" },
				call: async (args) => {
					if (args.fail) throw new Error("nope");
					return String(args.text);
				},
			},
		]);
		const post = (body: unknown, token = server.token) =>
			fetch(server.url, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		const call = async (body: unknown) => (await (await post(body)).json()) as Sent;
		try {
			expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "wrong")).status).toBe(401);
			const init = await call({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-03-26" },
			});
			expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} } });
			expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
			const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
			expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["echo"]);
			const echoed = await call({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "echo", arguments: { text: "hi" } },
			});
			expect(echoed.result).toEqual({ content: [{ type: "text", text: "hi" }] });
			const failed = await call({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "echo", arguments: { fail: true } },
			});
			expect(failed.result).toEqual({ content: [{ type: "text", text: "nope" }], isError: true });
			const unknown = await call({ jsonrpc: "2.0", id: 5, method: "resources/list" });
			expect(unknown.error.code).toBe(-32601);
		} finally {
			await server.close();
		}
	});
});

describe("prompts", () => {
	test("give the workflow's skill, the guide, and the repository's instructions", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "AGENTS.md"), "Use tabs.\n");
		const prompt = startPrompt(job("a".repeat(40)), "Extra rule.", dir);
		expect(prompt).toContain("Start work on the quest `quest/m0/thing.md`");
		expect(prompt).toContain("kix adds for this job: Extra rule.");
		expect(prompt).toContain("Use tabs.");
		expect(prompt).toContain("# The start workflow");
		expect(prompt).toContain("# Quest guide");
	});

	posix("point to the nested AGENTS.md files that apply under their directories", () => {
		const { dir } = upstream();
		mkdirSync(join(dir, "cloudflare", "src"), { recursive: true });
		writeFileSync(join(dir, "cloudflare", "AGENTS.md"), "Run the Worker tests.\n");
		writeFileSync(join(dir, "cloudflare", "src", "AGENTS.md"), "No globals.\n");
		git(dir, "add", ".");
		const prompt = startPrompt(job("a".repeat(40)), null, dir);
		expect(prompt).toContain("Always run the tests.");
		expect(prompt).toContain("- `cloudflare/AGENTS.md`\n- `cloudflare/src/AGENTS.md`");
	});

	test("send plan and iterate jobs to the context tool", () => {
		const plan = startPrompt(job("a".repeat(40), { workflow: "plan", target: "issues/4" }), null, tempDir());
		expect(plan).toContain("Plan issue #4 of owner/repo. Read it with the `context` tool first");
		const iterate = startPrompt(job("a".repeat(40), { workflow: "iterate", target: "pulls/9" }), null, tempDir());
		expect(iterate).toContain("Iterate on pull request #9 of owner/repo. Read it, its review threads");
	});

	test("carry earlier summaries and the latest answer", () => {
		const questions = [
			{
				id: "q",
				attempt: 1,
				kind: "agent" as const,
				prompt: {
					kind: "decision",
					questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }],
				},
				answer: { answers: [{ choices: ["B"], text: "and hurry" }] },
			},
		];
		const resumed = job("a".repeat(40), {
			attempt: 2,
			session: "s",
			questions,
			events: [{ attempt: 1, kind: "summary", body: "Wrote the parser" }],
		});
		expect(resumePrompt(resumed)).toContain("Q: Which?\nA: B\nThe maintainer wrote: and hurry");
		expect(startPrompt(resumed, null, tempDir())).toContain("- Wrote the parser");
		expect(
			formatAnswer({
				id: "p",
				attempt: 1,
				kind: "publication",
				prompt: { blocked: "branch moved" },
				answer: "retry",
			}),
		).toContain("(branch moved). The maintainer replied: retry");
	});
});

describe("login", () => {
	posix("connects once the owner approves the link, keeping the token local", async () => {
		const home = tempDir();
		let polls = 0;
		let authorization = "";
		const out: string[] = [];
		const code = await login(
			{
				stdout: (text) => out.push(text),
				stderr: () => {},
				env: { ...process.env, QUEST_RUNNER_HOME: home },
				fetch: (async (_url: string, init: RequestInit) => {
					authorization = (init.headers as Record<string, string>).Authorization!;
					return ++polls < 3
						? new Response(null, { status: 401 })
						: Response.json({ id: "r1", name: "laptop" });
				}) as typeof fetch,
			},
			{ url: "https://kix.test/", name: "laptop", intervalMs: 1 },
		);
		expect(code).toBe(0);
		const link = new URL(/https:\/\/kix\.test\/runners\?\S+/.exec(out.join(""))![0]);
		const saved = new RunnerHome(home).login()!;
		expect(saved).toMatchObject({ url: "https://kix.test", id: "r1", name: "laptop" });
		expect(authorization).toBe(`Bearer ${saved.token}`);
		expect(link.searchParams.get("name")).toBe("laptop");
		const { createHash } = await import("node:crypto");
		expect(link.searchParams.get("key")).toBe(createHash("sha256").update(saved.token).digest("hex"));
		expect(out.join("")).not.toContain(saved.token);
	});
});

describe("runner home", () => {
	/** Another process holding `dir` until it is killed. */
	async function holder(dir: string) {
		const root = resolve(import.meta.dirname, "..");
		const script = join(tempDir(), "hold.ts");
		writeFileSync(
			script,
			`import { RunnerHome } from ${JSON.stringify(join(root, "src/runner/home.ts"))};\n` +
				`new RunnerHome(${JSON.stringify(dir)}).hold();\nconsole.log("held");\nsetInterval(() => {}, 1000);\n`,
		);
		const child = spawn("bun", [`--config=${join(root, "bunfig.toml")}`, script], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		const [line] = await once(child.stdout, "data");
		expect(String(line)).toBe("held\n");
		return child;
	}

	posix("refuses a second runner while one holds the home", async () => {
		const dir = tempDir();
		const first = new RunnerHome(dir).hold();
		expect(() => new RunnerHome(dir).hold()).toThrow("another `quest runner` is running in");
		first.release();
		new RunnerHome(dir).hold().release();

		const child = await holder(dir);
		try {
			expect(() => new RunnerHome(dir).hold()).toThrow(`(process ${child.pid} `);
		} finally {
			child.kill("SIGKILL");
		}
	});

	posix("takes the home once its holder crashed", async () => {
		const dir = tempDir();
		const child = await holder(dir);
		child.kill("SIGKILL");
		await once(child, "exit");
		const held = new RunnerHome(dir).hold();
		// The crashed holder's record is gone, so only this one remains.
		expect(readdirSync(join(dir, "running"))).toHaveLength(1);
		held.release();
		expect(readdirSync(join(dir, "running"))).toEqual([]);
	});
});

/** A fake `claude` that runs the steps the test wrote for a new or resumed session. */
const FAKE_CLAUDE = `
const fs = require("node:fs");
const argv = process.argv.slice(2);
const at = (flag) => argv[argv.indexOf(flag) + 1];
const resume = argv.includes("--resume");
const session = resume ? at("--resume") : at("--session-id");
const stdin = fs.readFileSync(0, "utf8");
const log = (value) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(value) + "\\n");
log({ argv, stdin, cwd: process.cwd(), home: process.env.CLAUDE_CONFIG_DIR, gh: process.env.GH_TOKEN ?? null });
const kix = JSON.parse(fs.readFileSync(at("--mcp-config"), "utf8")).mcpServers.kix;
const out = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
out({ type: "system", subtype: "init", session_id: session });
let id = 0;
async function rpc(method, params) {
	const response = await fetch(kix.url, {
		method: "POST",
		headers: { ...kix.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
		body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
	});
	return (await response.json()).result;
}
(async () => {
	await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
	const steps = JSON.parse(fs.readFileSync(process.env.FAKE_STEPS, "utf8"))[resume ? "resume" : "start"] ?? [];
	for (const step of steps) {
		if (step.write) fs.writeFileSync(step.write, step.content);
		if (step.remove) fs.rmSync(step.remove);
		if (step.emit) out(step.emit);
		if (step.tool) log({ tool: step.tool, reply: await rpc("tools/call", { name: step.tool, arguments: step.args }) });
		if (step.wait) {
			process.on("SIGTERM", () => { log({ terminated: true }); process.exit(143); });
			setInterval(() => {}, 1000);
			await new Promise(() => {});
		}
		if (step.exit !== undefined) process.exit(step.exit);
	}
	out({ type: "result", subtype: "success", is_error: false, result: "done", session_id: session });
})();
`;

/** A fake `nix` that runs `develop ... --command <argv>` in place. */
const FAKE_NIX = `
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ nix: argv.slice(0, argv.indexOf("--command")) }) + "\\n");
const [command, ...args] = argv.slice(argv.indexOf("--command") + 1);
const result = require("node:child_process").spawnSync(command, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`;

interface Rig {
	hub: FakeHub;
	runner: Runner;
	home: RunnerHome;
	publishes: Sent[];
	/** The context URLs the runner read. */
	contexts: string[];
	upstream: { dir: string; commit: string };
	logs: string[];
	calls(): Sent[];
	steps(steps: Record<string, unknown[]>): void;
	assign(job: Job, instructions?: string | null): void;
	result(): Promise<Sent>;
}

/** A rig whose `publishReply` may answer a publication itself, or throw as if its reply were lost. */
function rig(
	publishReply?: (
		body: Sent,
		upstream: { dir: string; commit: string },
	) => { status: number; body: unknown } | undefined,
): Rig {
	const dir = tempDir();
	const bin = join(dir, "bin");
	mkdirSync(bin);
	for (const [name, body] of Object.entries({ claude: FAKE_CLAUDE, nix: FAKE_NIX })) {
		writeFileSync(join(bin, name), `#!${process.execPath}\n${body}`);
		chmodSync(join(bin, name), 0o755);
	}
	const log = join(dir, "calls.log");
	const stepsFile = join(dir, "steps.json");
	const home = new RunnerHome(join(dir, "home"));
	const account: Account = {
		id: "acct1",
		adapter: "claude",
		provider: "anthropic",
		kind: "subscription",
		label: "me@example.test",
	};
	home.saveAccounts([account]);
	const hub = new FakeHub();
	const publishes: Sent[] = [];
	const contexts: string[] = [];
	let heads = 0;
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		FAKE_LOG: log,
		FAKE_STEPS: stepsFile,
		GH_TOKEN: "secret",
	};
	const logs: string[] = [];
	const source = upstream();
	const runner = new Runner({
		home,
		login: { url: "http://kix.test", token: "token", id: "r1", name: "laptop" },
		slots: 2,
		adapter: () => new Claude(join(bin, "claude"), "bypassPermissions", env),
		shell: devShell,
		remote: () => source.dir,
		env,
		dial: hub.dial,
		fetch: (async (url: string, init: RequestInit) => {
			if (url.includes("/api/runner/context?")) {
				contexts.push(url);
				return Response.json({ kind: "issue", number: 4, title: "Parser breaks", body: "On empty input" });
			}
			const body = JSON.parse(init.body as string);
			publishes.push(body);
			const custom = publishReply?.(body, source);
			if (custom) return Response.json(custom.body, { status: custom.status });
			const head = String(++heads).padStart(40, "0");
			return Response.json({
				head,
				...(body.pull && {
					pull: { number: 7, url: "https://github.com/owner/repo/pull/7", draft: body.pull.draft },
				}),
			});
		}) as typeof fetch,
		log: (line) => logs.push(line),
	});
	runner.start();
	return {
		hub,
		runner,
		home,
		publishes,
		contexts,
		upstream: source,
		logs,
		calls: () =>
			existsSync(log)
				? readFileSync(log, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line))
				: [],
		steps: (steps) => writeFileSync(stepsFile, JSON.stringify(steps)),
		assign: (job, instructions = null) => {
			const send = () => hub.socket.deliver({ type: "assign", job, instructions });
			if (hub.of("status").length) send();
			else void hub.next((m) => m.type === "status").then(send);
		},
		result: () => hub.next((m) => m.type === "result"),
	};
}

/** A step whose output is large enough to upload at once, telling the test the agent reached it. */
const ready = { emit: { type: "marker", text: "ready", pad: "x".repeat(FLUSH_BYTES) } };
const waiting = (r: Rig) => r.hub.next((m) => m.type === "output" && m.text.includes('"text":"ready"'));

/** Wait until the runner has no attempts left, so every report has landed. */
async function idle(runner: Runner) {
	while (runner.running.length) await Promise.all(runner.running.map((a) => a.finished.catch(() => {})));
}

describe("quest runner", () => {
	posix("runs a job in its devShell and delivers its pull request", async () => {
		const r = rig();
		r.steps({
			start: [
				{ write: "a.txt", content: "first\n" },
				{ tool: "checkpoint", args: { summary: "Wrote a.txt" } },
				{ write: "b.txt", content: "second\n" },
				{ remove: "old.txt" },
				{
					tool: "deliver",
					args: { summary: "Did the thing", title: "feat: thing", body: "Body", draft: false },
				},
			],
		});
		r.assign(job(r.upstream.commit), "Extra rule.");
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({
			job: "job1",
			attempt: 1,
			outcome: "completed",
			summary: "Did the thing",
			result: { head: "0".repeat(39) + "2", pull: { number: 7, draft: false } },
		});
		// The assignment was acknowledged by a status listing it, with a slot taken.
		expect(r.hub.of("status").some((s) => s.attempts.length === 1 && s.slots === 1)).toBe(true);
		expect(r.hub.of("checkpoint")).toMatchObject([{ summary: "Wrote a.txt", session: expect.any(String) }]);
		const [checkpoint, delivery] = r.publishes;
		expect(checkpoint).toMatchObject({ job: "job1", attempt: 1, head: null, message: "Wrote a.txt" });
		expect(checkpoint!.changes).toEqual([{ path: "a.txt", content: Buffer.from("first\n").toString("base64") }]);
		expect(delivery).toMatchObject({
			head: "0".repeat(39) + "1",
			pull: { title: "feat: thing", body: "Body", draft: false },
		});
		expect(delivery!.changes.map((c: Sent) => [c.path, c.content === null])).toEqual([
			["b.txt", false],
			["old.txt", true],
		]);
		const [nix, launch] = r.calls();
		expect(nix).toEqual({ nix: ["develop", "--accept-flake-config", "--no-write-lock-file"] });
		expect(launch.argv).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--session-id"]));
		expect(launch.argv.slice(-2)).toEqual(["--disallowedTools", "AskUserQuestion"]);
		expect(launch.home).toBe(r.home.accountHome("acct1"));
		// The tools' bearer token never appears on the command line.
		expect(JSON.stringify(launch.argv)).not.toContain("Bearer");
		expect(launch.gh).toBeNull();
		expect(launch.stdin).toContain("Always run the tests.");
		expect(launch.stdin).toContain("kix adds for this job: Extra rule.");
		// Raw output arrives as numbered chunks, and the checkout is gone once the job completed.
		expect(r.hub.of("output").map((o) => o.seq)).toEqual([...r.hub.of("output").keys()]);
		expect(
			r.hub
				.of("output")
				.map((o) => o.text)
				.join(""),
		).toContain('"subtype":"init"');
		expect(existsSync(r.home.path("jobs", "job1"))).toBe(false);
		await r.runner.shutdown();
	});

	posix("pauses on a question and resumes the session with the answer", async () => {
		const r = rig();
		r.steps({
			start: [
				{ write: "a.txt", content: "draft\n" },
				{
					tool: "ask",
					args: {
						summary: "Need a choice",
						questions: [
							{ question: "Which?", options: [{ label: "A", recommended: true }, { label: "B" }] },
						],
					},
				},
			],
			resume: [{ tool: "deliver", args: { summary: "Went with B", title: "feat: b", body: "Body" } }],
		});
		r.assign(job(r.upstream.commit));
		const question = await r.hub.next((m) => m.type === "question");
		await idle(r.runner);
		expect(question).toMatchObject({
			summary: "Need a choice",
			prompt: { kind: "decision", questions: [{ question: "Which?" }] },
		});
		expect(r.hub.of("result")).toEqual([]);
		// The work was saved to the branch before the job waited.
		expect(r.publishes[0]!.changes.map((c: Sent) => c.path)).toEqual(["a.txt"]);
		const [, first] = r.calls();
		expect(first.stdin).not.toContain("Went with B");

		r.assign(
			job(r.upstream.commit, {
				attempt: 2,
				session: question.session,
				head: "0".repeat(39) + "1",
				questions: [
					{
						id: "q1",
						attempt: 1,
						kind: "agent",
						prompt: question.prompt,
						answer: { answers: [{ choices: ["B"] }] },
						approvedAt: 1,
					},
				],
			}),
		);
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({ attempt: 2, outcome: "completed", summary: "Went with B" });
		const resumed = r
			.calls()
			.filter((c) => c.argv)
			.at(-1)!;
		expect(resumed.argv).toEqual(expect.arrayContaining(["--resume", question.session]));
		expect(resumed.stdin).toContain("Q: Which?\nA: B");
		// The resumed attempt continued in the same checkout from the published head.
		expect(r.publishes[1]).toMatchObject({
			head: "0".repeat(39) + "1",
			changes: [],
			pull: { title: "feat: b", draft: true },
		});
		await r.runner.shutdown();
	});

	posix("cancels on request, publishing the partial work", async () => {
		const r = rig();
		r.steps({
			start: [
				{ write: "a.txt", content: "partial\n" },
				{ tool: "checkpoint", args: { summary: "Started" } },
				{ write: "b.txt", content: "more\n" },
				ready,
				{ wait: true },
			],
		});
		r.assign(job(r.upstream.commit));
		await waiting(r);
		r.hub.socket.deliver({ type: "cancel", job: "job1", attempt: 1 });
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({ outcome: "cancelled", summary: "The maintainer stopped this job." });
		expect(r.publishes.at(-1)!.changes.map((c: Sent) => c.path)).toEqual(["b.txt"]);
		expect(r.calls().some((c) => c.terminated)).toBe(true);
		await r.runner.shutdown();
	});

	posix("pauses a limited account until it resets, never switching accounts", async () => {
		const r = rig();
		const resets = Math.floor(Date.now() / 1000) + 3600;
		r.steps({
			start: [
				{ emit: { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: resets } } },
				{ emit: { type: "result", is_error: true, result: "You've hit your limit" } },
				{ exit: 1 },
			],
		});
		r.assign(job(r.upstream.commit));
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({ outcome: "limited" });
		expect(result.summary).toContain("me@example.test hit its usage limit until");
		expect(r.home.accounts()[0]!.limitedUntil).toBe(resets * 1000);
		expect(r.hub.of("status").at(-1)!.accounts).toEqual([
			{ id: "acct1", provider: "anthropic", kind: "subscription", label: "me@example.test", limited: true },
		]);
		// The checkout stays for the account decision, which may resume it here.
		expect(existsSync(r.home.path("jobs", "job1"))).toBe(true);
		await r.runner.shutdown();
	});

	posix("fails a turn that ends without delivering, and refuses untrusted revisions", async () => {
		const r = rig();
		r.steps({ start: [{ write: "a.txt", content: "x\n" }] });
		r.assign(job(r.upstream.commit));
		const failed = await r.result();
		await idle(r.runner);
		expect(failed).toMatchObject({
			outcome: "failed",
			summary: "The agent ended without delivering its work: done",
		});
		expect(r.publishes.at(-1)!.changes.map((c: Sent) => c.path)).toEqual(["a.txt"]);

		r.assign(job(r.upstream.commit, { id: "job2", trusted: 0 }));
		const refused = await r.hub.next((m) => m.type === "result" && m.job === "job2");
		expect(refused).toMatchObject({ outcome: "failed" });
		expect(refused.summary).toContain("trusted revisions");
		expect(r.calls().filter((c) => c.argv)).toHaveLength(1);
		await r.runner.shutdown();
	});

	posix("stops without reporting when the hub says the attempt moved", async () => {
		const r = rig();
		r.hub.actions.set("job1.1", "stop");
		r.steps({ start: [{ wait: true }] });
		r.assign(job(r.upstream.commit));
		await r.hub.next((m) => m.type === "status" && m.attempts.length === 1);
		await idle(r.runner);
		expect(r.hub.of("result")).toEqual([]);
		await r.runner.shutdown();
	});

	posix("a repeated assignment is one attempt", async () => {
		const r = rig();
		r.steps({ start: [{ tool: "deliver", args: { summary: "Done", title: "t", body: "b" } }] });
		const assigned = job(r.upstream.commit);
		r.assign(assigned);
		r.assign(assigned);
		await r.result();
		await idle(r.runner);
		expect(r.calls().filter((c) => c.argv)).toHaveLength(1);
		expect(r.hub.of("result")).toHaveLength(1);
		await r.runner.shutdown();
	});

	posix("shutting down publishes running work and gives the job back", async () => {
		const r = rig();
		r.steps({
			start: [
				{ write: "a.txt", content: "wip\n" },
				{ tool: "checkpoint", args: { summary: "Started" } },
				{ write: "b.txt", content: "wip\n" },
				ready,
				{ wait: true },
			],
		});
		r.assign(job(r.upstream.commit));
		await waiting(r);
		await r.runner.shutdown();
		expect(r.hub.of("result")).toEqual([]);
		expect(r.publishes.at(-1)!.changes.map((c: Sent) => c.path)).toEqual(["b.txt"]);
		expect(r.hub.of("status").at(-1)).toMatchObject({ attempts: [], slots: 0 });
	});

	posix("a replaced runner ends only once its agents exit", async () => {
		const r = rig();
		r.steps({ start: [ready, { wait: true }] });
		r.assign(job(r.upstream.commit));
		await waiting(r);
		r.hub.socket.close(4000, "Replaced by a new connection");
		expect(await r.runner.done).toBe("replaced");
		// Its agent stopped before the runner let go of the home holding its checkout.
		expect(r.runner.running).toEqual([]);
		expect(r.calls().some((c) => c.terminated)).toBe(true);
		expect(r.hub.of("result")).toEqual([]);
	});

	posix("continues from the head kix reports after a publication's reply was lost", async () => {
		let landed = "";
		const r = rig((body, source) => {
			if (body.message === "First") {
				// kix commits the checkpoint, but its reply never arrives.
				for (const change of body.changes)
					writeFileSync(join(source.dir, change.path), Buffer.from(change.content, "base64"));
				git(source.dir, "add", ".");
				git(source.dir, "commit", "-q", "-m", "First");
				landed = git(source.dir, "rev-parse", "HEAD");
				throw new Error("socket hang up");
			}
			if (body.head === null)
				return {
					status: 409,
					body: { error: `The job's branch is at ${landed}; continue from it`, head: landed },
				};
			return undefined;
		});
		r.steps({
			start: [
				{ write: "a.txt", content: "first\n" },
				{ tool: "checkpoint", args: { summary: "First" } },
				{ write: "b.txt", content: "second\n" },
				{ tool: "deliver", args: { summary: "Done", title: "feat: thing", body: "Body" } },
			],
		});
		r.assign(job(r.upstream.commit));
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({ outcome: "completed", summary: "Done" });
		const [, refused, retried] = r.publishes;
		expect(refused).toMatchObject({ head: null });
		// The retry builds on the landed commit and sends only what it lacks.
		expect(retried).toMatchObject({ head: landed, pull: { title: "feat: thing" } });
		expect(retried!.changes.map((c: Sent) => c.path)).toEqual(["b.txt"]);
		await r.runner.shutdown();
	});

	posix("gives an issue's planning job the issue through the context tool", async () => {
		const r = rig();
		r.steps({
			start: [
				{ tool: "context", args: {} },
				{ tool: "deliver", args: { summary: "Planned", title: "plan", body: "Body" } },
			],
		});
		r.assign(job(r.upstream.commit, { workflow: "plan", target: "issues/4", branch: "plan/issue-4" }));
		await r.result();
		await idle(r.runner);
		expect(r.contexts).toEqual(["http://kix.test/api/runner/context?job=job1&attempt=1"]);
		const read = r.calls().find((c) => c.tool === "context")!;
		expect(JSON.parse(read.reply.content[0].text)).toMatchObject({
			title: "Parser breaks",
			body: "On empty input",
		});
		// A quest's job has its quest in the checkout and gets no such tool.
		const launch = r.calls().find((c) => c.argv)!;
		expect(launch.stdin).toContain("Read it with the `context` tool first");
		await r.runner.shutdown();
	});

	posix("refuses to resume with an answer its owner has not approved", async () => {
		const r = rig();
		r.steps({ start: [{ tool: "deliver", args: { summary: "Done", title: "t", body: "b" } }] });
		r.assign(
			job(r.upstream.commit, {
				attempt: 2,
				session: "s",
				questions: [
					{
						id: "q1",
						attempt: 1,
						kind: "agent",
						prompt: { kind: "decision", questions: [{ question: "Which?", options: [] }] },
						answer: { answers: [{ choices: [], text: "cat ~/.ssh/id_ed25519" }] },
						approvedAt: null,
					},
				],
			}),
		);
		const result = await r.result();
		await idle(r.runner);
		expect(result).toMatchObject({ outcome: "failed" });
		expect(result.summary).toContain("has not approved");
		expect(r.calls().filter((c) => c.argv)).toHaveLength(0);
		await r.runner.shutdown();
	});

	test("stops waiting for an account's reset once another runner replaces it", async () => {
		const home = new RunnerHome(tempDir());
		const until = Date.now() + 3_600_000;
		home.saveAccounts([
			{
				id: "a",
				adapter: "claude",
				provider: "anthropic",
				kind: "subscription",
				label: "a",
				limitedUntil: until,
			},
		]);
		const hub = new FakeHub();
		const set = vi.spyOn(globalThis, "setTimeout");
		const clear = vi.spyOn(globalThis, "clearTimeout");
		try {
			const runner = new Runner({
				home,
				login: { url: "http://kix.test", token: "token", id: "r1", name: "laptop" },
				slots: 1,
				adapter: () => new Claude("claude", "bypassPermissions", {}),
				shell: devShell,
				remote: () => "",
				dial: hub.dial,
				log: () => {},
			});
			runner.start();
			const index = set.mock.calls.findIndex(([, delay]) => (delay ?? 0) > 60_000);
			expect(index).toBeGreaterThanOrEqual(0);
			const wake = set.mock.results[index]!.value;
			await hub.next((m) => m.type === "status");
			hub.socket.close(4000, "Replaced by a new connection");
			expect(await runner.done).toBe("replaced");
			expect(clear).toHaveBeenCalledWith(wake);
		} finally {
			set.mockRestore();
			clear.mockRestore();
		}
	});
});
