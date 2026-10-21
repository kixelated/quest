import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

import { agentEnvironment, spawnDirectory } from "../src/cli/agent";
import { type Output, main } from "../src/cli/main";
import { tempDir } from "./fixture";

afterEach(() => vi.unstubAllEnvs());

/** The fake agent CLIs are shebang scripts found on a POSIX PATH, which Windows cannot run. */
const fakes = test.skipIf(process.platform === "win32");

/**
 * Fake agent CLIs and secret manager. Each logs its argv, stdin, and the
 * variables it was given, then behaves as FAKE_MODE says.
 */
const FAKES: Record<string, string> = {
	claude: `
const fs = require("node:fs");
const argv = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(CLAUDE|ANTHROPIC|QUEST|OP_|CODEX)/.test(k)));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, stdin, env, cwd: process.cwd() }) + "\\n");
const at = (flag) => argv[argv.indexOf(flag) + 1];
const session = argv.includes("--resume") ? at("--resume") : at("--session-id");
const key = process.env.ANTHROPIC_API_KEY;
const result = (fields) => console.log(JSON.stringify({ type: "result", session_id: session, ...fields }));
if (process.env.FAKE_MODE === "exhausted") {
	result({ is_error: true, result: "Credit balance is too low" });
	process.exit(1);
}
if (process.env.FAKE_MODE === "leak") {
	// The key arrives on stderr in two separate writes.
	process.stderr.write("using " + key.slice(0, 4));
	setTimeout(() => {
		process.stderr.write(key.slice(4) + "\\nunterminated " + key);
		result({ is_error: false, result: "leaked" });
	}, 100);
} else if (process.env.FAKE_MODE === "sleep") {
	process.on("SIGTERM", () => {
		fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ terminated: true }) + "\\n");
		process.exit(143);
	});
	setInterval(() => {}, 1000);
} else {
	result({ is_error: false, result: "done with " + key, total_cost_usd: 0.25 });
}
`,
	codex: `
const fs = require("node:fs");
const argv = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(CLAUDE|ANTHROPIC|QUEST|OP_|CODEX)/.test(k)));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, stdin, env, cwd: process.cwd() }) + "\\n");
const event = (value) => console.log(JSON.stringify(value));
const resume = argv[1] === "resume";
event({ type: "thread.started", thread_id: resume ? argv[argv.length - 2] : "thread-1" });
event({ type: "turn.started" });
if (process.env.FAKE_MODE === "exhausted") {
	event({ type: "error", message: "insufficient_quota: You exceeded your current quota" });
	event({ type: "turn.failed", error: { message: "insufficient_quota" } });
	process.exit(1);
}
event({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "first" } });
event({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "final reply" } });
event({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
`,
	op: `
const fs = require("node:fs");
const template = fs.readFileSync(0, "utf8");
fs.appendFileSync(process.env.FAKE_OP_LOG, template + "--\\n");
process.stdout.write(template.replace(/\\{\\{ op:\\/\\/[^/]+\\/[^/]+\\/([^ ]+) \\}\\}/g, "resolved-$1"));
`,
};

interface Setup {
	worktree: string;
	runtime: string;
	log: string;
	opLog: string;
	/** Every logged invocation of a fake agent CLI. */
	calls(): Record<string, unknown>[];
}

function setup(keys = "sk-literal op://vault/item/second"): Setup {
	const dir = tempDir();
	const bin = join(dir, "bin");
	mkdirSync(bin);
	for (const [name, body] of Object.entries(FAKES)) {
		const path = join(bin, name);
		writeFileSync(path, `#!${process.execPath}\n${body}`);
		chmodSync(path, 0o755);
	}
	const worktree = join(dir, "repo");
	mkdirSync(worktree);
	execFileSync("git", ["-C", worktree, "init", "-q"]);
	const runtime = join(dir, "runtime");
	mkdirSync(runtime, { mode: 0o700 });
	const log = join(dir, "agent.log");
	const opLog = join(dir, "op.log");
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("XDG_RUNTIME_DIR", runtime);
	vi.stubEnv("QUEST_API_KEYS", keys);
	vi.stubEnv("FAKE_LOG", log);
	vi.stubEnv("FAKE_OP_LOG", opLog);
	// The coordinating session's own harness state and credentials.
	vi.stubEnv("CLAUDECODE", "1");
	vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
	vi.stubEnv("ANTHROPIC_API_KEY", "sk-session");
	vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "ops-token");
	vi.stubEnv("CODEX_THREAD_ID", "parent");
	vi.stubEnv("CODEX_HOME", join(dir, "codex"));
	return {
		worktree,
		runtime,
		log,
		opLog,
		calls: () =>
			existsSync(log)
				? readFileSync(log, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line) as Record<string, unknown>)
				: [],
	};
}

async function quest(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	let stdout = "";
	let stderr = "";
	const out: Output = {
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
	};
	const code = await main(args, out);
	return { code, stdout, stderr };
}

const launch = (harness: string, key: string) => [
	"--harness",
	harness,
	"--key",
	key,
	"--model",
	"opus",
	"--effort",
	"high",
	"--permission-mode",
	"auto",
];

test("the agent environment holds only its own key", () => {
	const env = agentEnvironment(
		{
			PATH: "/bin",
			HOME: "/home/me",
			CLAUDECODE: "1",
			CLAUDE_CODE_SSE_PORT: "1",
			ANTHROPIC_API_KEY: "sk-session",
			ANTHROPIC_BASE_URL: "https://proxy",
			QUEST_API_KEYS: "a b",
			QUEST_GATE_ADMITTED: "1",
			OP_SERVICE_ACCOUNT_TOKEN: "t",
			OP_SESSION_me: "s",
			OPENAI_API_KEY: "o",
			CODEX_SANDBOX: "seatbelt",
			CODEX_HOME: "/home/me/.codex",
		},
		"ANTHROPIC_API_KEY",
		"sk-agent",
	);
	expect(env).toEqual({
		PATH: "/bin",
		HOME: "/home/me",
		CODEX_HOME: "/home/me/.codex",
		ANTHROPIC_API_KEY: "sk-agent",
	});
});

fakes("start runs claude with every launch setting, one resolved key, and no key in its output", async () => {
	const s = setup();
	const result = await quest("agent", "start", ...launch("claude", "2"), s.worktree, "/quest-start quest/m0/a.md");
	expect(result.code).toBe(0);
	const [call] = s.calls();
	const argv = call.argv as string[];
	const session = argv[argv.indexOf("--session-id") + 1];
	expect(argv).toEqual([
		"-p",
		"--output-format",
		"json",
		"--model",
		"opus",
		"--effort",
		"high",
		"--permission-mode",
		"auto",
		"--session-id",
		session,
	]);
	expect(call.stdin).toBe("/quest-start quest/m0/a.md");
	expect(call.cwd).toBe(
		execFileSync("git", ["-C", s.worktree, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
	);
	// Only its own key: no session credentials, harness markers, other keys, or secret-manager token.
	expect(call.env).toEqual({ ANTHROPIC_API_KEY: "resolved-second", CODEX_HOME: process.env.CODEX_HOME });
	expect(result.stdout).toBe(`session ${session}\ncost 0.25\noutcome finished\n\ndone with <key 2>\n`);
	expect(result.stdout + result.stderr).not.toContain("resolved-second");
	// The op:// entry resolved in one invocation; the literal key never reached op.
	expect(readFileSync(s.opLog, "utf8")).toBe("{{ op://vault/item/second }}\n--\n");
});

fakes("keys resolve once per spawn into a user-only store, and stop --all deletes them", async () => {
	const s = setup();
	expect((await quest("agent", "start", ...launch("claude", "1"), s.worktree, "one")).code).toBe(0);
	expect((await quest("agent", "start", ...launch("claude", "2"), s.worktree, "two")).code).toBe(0);
	expect(readFileSync(s.opLog, "utf8").split("--\n").filter(Boolean)).toHaveLength(1);
	expect(s.calls().map((call) => (call.env as Record<string, string>).ANTHROPIC_API_KEY)).toEqual([
		"sk-literal",
		"resolved-second",
	]);
	const dir = spawnDirectory(join(s.runtime, "quest", "agent"), s.worktree);
	const keys = join(dir, "keys.json");
	expect(statSync(keys).mode & 0o777).toBe(0o600);
	expect(statSync(dir).mode & 0o077).toBe(0);

	// A different QUEST_API_KEYS resolves again rather than reusing stale keys.
	vi.stubEnv("QUEST_API_KEYS", "op://vault/item/third");
	expect((await quest("agent", "start", ...launch("claude", "1"), s.worktree, "three")).code).toBe(0);
	expect(readFileSync(s.opLog, "utf8").split("--\n").filter(Boolean)).toHaveLength(2);

	const stop = await quest("--root", s.worktree, "agent", "stop", "--all");
	expect(stop).toEqual({ code: 0, stdout: "deleted the resolved keys\n", stderr: "" });
	expect(existsSync(dir)).toBe(false);
});

fakes("a launch that died leaves no lock or record that blocks the next launch", async () => {
	const s = setup();
	const dir = spawnDirectory(join(s.runtime, "quest", "agent"), s.worktree);
	mkdirSync(join(dir, "agents"), { recursive: true });
	const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
	const lock = join(dir, "resolving");
	writeFileSync(lock, String(dead));
	// A record named as a launch names it: the worktree's digest, then the run.
	const records = join(dir, "agents");
	const worktree = createHash("sha256").update(realpathSync(s.worktree)).digest("hex").slice(0, 16);
	writeFileSync(
		join(records, `${worktree}.stale.json`),
		JSON.stringify({ pid: dead, child: dead, worktree: s.worktree }),
	);
	expect((await quest("agent", "start", ...launch("claude", "2"), s.worktree, "go")).code).toBe(0);
	expect(existsSync(lock)).toBe(false);
	expect(readdirSync(records)).toEqual([]);
});

fakes("a key with no credit exits 3 so the spawn resumes on the next key", async () => {
	const s = setup();
	vi.stubEnv("FAKE_MODE", "exhausted");
	const started = await quest("agent", "start", ...launch("claude", "1"), s.worktree, "go");
	expect(started.code).toBe(3);
	const session = /^session (\S+)$/m.exec(started.stdout)![1];
	expect(started.stdout).toBe(`session ${session}\noutcome exhausted\n\nCredit balance is too low\n`);

	vi.stubEnv("FAKE_MODE", "");
	const resumed = await quest("agent", "resume", ...launch("claude", "2"), s.worktree, session, "continue");
	expect(resumed.code).toBe(0);
	const call = s.calls()[1];
	expect(call.argv).toContain("--resume");
	expect(call.argv).toContain(session);
	expect(call.argv).not.toContain("--session-id");
	expect(call.stdin).toBe("continue");
	expect((call.env as Record<string, string>).ANTHROPIC_API_KEY).toBe("resolved-second");
});

fakes("codex runs with its key variable and reports its thread and last message", async () => {
	const s = setup();
	const started = await quest("agent", "start", ...launch("codex", "1"), s.worktree, "go");
	expect(started).toEqual({ code: 0, stdout: "session thread-1\noutcome finished\n\nfinal reply\n", stderr: "" });
	expect(s.calls()[0].argv).toEqual([
		"exec",
		"--json",
		"-m",
		"opus",
		"-c",
		'model_reasoning_effort="high"',
		"-c",
		'sandbox_mode="auto"',
		"-c",
		'approval_policy="never"',
		"-",
	]);
	expect(s.calls()[0].env).toEqual({ CODEX_API_KEY: "sk-literal", CODEX_HOME: process.env.CODEX_HOME });

	const resumed = await quest("agent", "resume", ...launch("codex", "2"), s.worktree, "thread-1", "answer");
	expect(resumed.code).toBe(0);
	expect((s.calls()[1].argv as string[]).slice(0, 3)).toEqual(["exec", "resume", "--json"]);
	expect((s.calls()[1].argv as string[]).slice(-2)).toEqual(["thread-1", "-"]);

	vi.stubEnv("FAKE_MODE", "exhausted");
	const exhausted = await quest("agent", "start", ...launch("codex", "1"), s.worktree, "go");
	expect(exhausted).toEqual({
		code: 3,
		stdout: "session thread-1\noutcome exhausted\n\ninsufficient_quota\n",
		stderr: "",
	});
});

fakes("stop ends a live agent, which reports it as stopped", async () => {
	const s = setup();
	vi.stubEnv("FAKE_MODE", "sleep");
	const running = quest("agent", "start", ...launch("claude", "1"), s.worktree, "go");
	const records = join(spawnDirectory(join(s.runtime, "quest", "agent"), s.worktree), "agents");
	await vi.waitFor(() => {
		expect(readdirSync(records)).toHaveLength(1);
		expect(s.calls()).toHaveLength(1);
	});

	// A second agent in the same worktree is refused while the first runs.
	const second = await quest("agent", "start", ...launch("claude", "1"), s.worktree, "again");
	expect(second.code).toBe(1);
	expect(second.stderr).toContain("an agent is already running");

	const stopped = await quest("agent", "stop", s.worktree);
	expect(stopped.code).toBe(0);
	expect(stopped.stdout).toMatch(/^stopped .* session \S+\n$/);
	const started = await running;
	expect(started.code).toBe(1);
	expect(started.stdout).toMatch(/^session \S+\noutcome stopped\n$/);
	expect(s.calls()[1]).toEqual({ terminated: true });
	expect(readdirSync(records)).toEqual([]);

	expect((await quest("agent", "stop", s.worktree)).stdout).toBe("no agent running\n");
});

fakes("stderr is redacted even when a key spans two writes", async () => {
	const s = setup();
	vi.stubEnv("FAKE_MODE", "leak");
	const result = await quest("agent", "start", ...launch("claude", "2"), s.worktree, "go");
	expect(result.code).toBe(0);
	expect(result.stderr).toBe("using <key 2>\nunterminated <key 2>");
});

fakes("concurrent launches in one worktree run only one agent", async () => {
	const s = setup();
	vi.stubEnv("FAKE_MODE", "sleep");
	const first = quest("agent", "start", ...launch("claude", "1"), s.worktree, "one");
	const second = quest("agent", "start", ...launch("claude", "2"), s.worktree, "two");
	// The refused launch returns first; the other runs until stopped.
	const refused = await Promise.race([first, second]);
	expect(refused.code).toBe(1);
	expect(refused.stderr).toContain("an agent is already running");
	await vi.waitFor(() => expect(s.calls()).toHaveLength(1));
	expect((await quest("agent", "stop", s.worktree)).code).toBe(0);
	const results = await Promise.all([first, second]);
	expect(results.filter((result) => result.stdout.endsWith("outcome stopped\n"))).toHaveLength(1);
	expect(s.calls().filter((call) => "argv" in call)).toHaveLength(1);
});

test("missing keys, positions past the list, and unknown references are usage errors", async () => {
	const s = setup("sk-one vault://x");
	const unknown = await quest("agent", "start", ...launch("claude", "1"), s.worktree, "go");
	expect(unknown).toMatchObject({
		code: 2,
		stderr: "error: QUEST_API_KEYS has a vault:// reference; only op:// is supported\n",
	});

	vi.stubEnv("QUEST_API_KEYS", "sk-one");
	const past = await quest("agent", "start", ...launch("claude", "2"), s.worktree, "go");
	expect(past).toMatchObject({ code: 2, stderr: "error: --key 2 is past the 1 entries in QUEST_API_KEYS\n" });

	vi.stubEnv("QUEST_API_KEYS", "");
	expect((await quest("agent", "start", ...launch("claude", "1"), s.worktree, "go")).code).toBe(2);
	expect((await quest("agent", "stop")).code).toBe(2);
	expect(s.calls()).toEqual([]);
});
