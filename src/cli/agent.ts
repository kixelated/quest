// `quest agent`: start, resume, and stop headless agents billed to API keys.
//
// One command owns what a spawn would otherwise script again each time: it
// resolves `QUEST_API_KEYS` once into a user-only store, gives each agent only
// the key its position names, strips the coordinating session's harness
// variables, and reads the agent's session, reply, and cost. Its own arguments
// name the harness, worktree, key, model, effort, and permission mode, so a
// permission classifier reading the call sees the whole launch.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const HARNESSES = ["claude", "codex"] as const;
export type HarnessName = (typeof HARNESSES)[number];

/** Everything a launch names on its command line. */
export interface Launch {
	harness: HarnessName;
	/** The key's 1-based position in `QUEST_API_KEYS`. */
	key: number;
	model: string;
	effort: string;
	/** Claude Code's `--permission-mode`, or Codex's sandbox mode. */
	permissionMode: string;
	worktree: string;
}

/** What an agent run reports when its process exits. */
export interface Result {
	session?: string;
	reply?: string;
	/** Dollars, when the agent reports them. */
	cost?: number;
	/** The provider refused the key for lack of credit. */
	exhausted: boolean;
	/** The agent reported an error, whatever its exit status. */
	failed: boolean;
}

export type Outcome = "finished" | "failed" | "exhausted" | "stopped";

/** Exit statuses: a finished agent exits 0, an exhausted key 3, and anything else 1. */
const EXIT: Record<Outcome, number> = { finished: 0, failed: 1, exhausted: 3, stopped: 1 };

/** How one agent CLI is launched and read. The prompt always arrives on stdin. */
interface Harness {
	/** The variable the agent CLI reads its API key from. */
	keyVariable: string;
	/** Argv for a new session, given a session id to assign where the CLI accepts one. */
	start(launch: Launch, session: string): string[];
	resume(launch: Launch, session: string): string[];
	/** The session id announced by one line of output, if any. */
	announced(line: string): string | undefined;
	parse(stdout: string, stderr: string): Result;
}

/** Provider messages for a key whose balance cannot pay for the request. */
const EXHAUSTED = /credit balance is too low|insufficient_quota|exceeded your current quota/i;

function json(line: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(line);
		return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** `claude -p --output-format json` prints one result object when the turn ends. */
const claude: Harness = {
	keyVariable: "ANTHROPIC_API_KEY",
	start: (launch, session) => [...claudeFlags(launch), "--session-id", session],
	resume: (launch, session) => [...claudeFlags(launch), "--resume", session],
	// The session id is assigned at start, so it is known before any output.
	announced: () => undefined,
	parse(stdout, stderr) {
		const result = stdout
			.split("\n")
			.map(json)
			.filter((value) => value?.type === "result")
			.pop();
		const reply = text(result?.result);
		const cost = result?.total_cost_usd;
		return {
			session: text(result?.session_id),
			reply,
			cost: typeof cost === "number" ? cost : undefined,
			exhausted: EXHAUSTED.test(`${reply ?? ""}\n${stderr}`),
			failed: result === undefined || result.is_error === true,
		};
	},
};

function claudeFlags(launch: Launch): string[] {
	return [
		"claude",
		"-p",
		"--output-format",
		"json",
		"--model",
		launch.model,
		"--effort",
		launch.effort,
		"--permission-mode",
		launch.permissionMode,
	];
}

/** `codex exec --json` streams JSONL events: the thread id first, the reply in the last agent message. */
const codex: Harness = {
	keyVariable: "CODEX_API_KEY",
	start: (launch) => ["codex", "exec", "--json", ...codexFlags(launch), "-"],
	resume: (launch, session) => ["codex", "exec", "resume", "--json", ...codexFlags(launch), session, "-"],
	announced(line) {
		const event = json(line);
		return event?.type === "thread.started" ? text(event.thread_id) : undefined;
	},
	parse(stdout, stderr) {
		let session: string | undefined;
		let reply: string | undefined;
		const errors: string[] = [];
		let failed = false;
		for (const event of stdout.split("\n").map(json)) {
			if (event === undefined) continue;
			if (event.type === "thread.started") session = text(event.thread_id) ?? session;
			const item = event.item as Record<string, unknown> | undefined;
			if (event.type === "item.completed" && item?.type === "agent_message") reply = text(item.text) ?? reply;
			if (event.type === "turn.failed" || event.type === "error") {
				failed = true;
				const error = event.error as Record<string, unknown> | undefined;
				errors.push(text(error?.message) ?? text(event.message) ?? "");
			}
		}
		return {
			session,
			// A turn that failed before replying reports why, as `claude -p` does.
			reply: reply ?? errors.at(-1),
			exhausted: EXHAUSTED.test(`${errors.join("\n")}\n${stderr}`),
			failed: failed || reply === undefined,
		};
	},
};

/** Codex takes effort and sandbox as TOML config values, so only plain words pass. */
function codexFlags(launch: Launch): string[] {
	for (const [name, value] of [
		["effort", launch.effort],
		["permission mode", launch.permissionMode],
	]) {
		if (!/^[\w.-]+$/.test(value)) throw new AgentInputError(`${name} must be a plain word for codex`);
	}
	return [
		"-m",
		launch.model,
		"-c",
		`model_reasoning_effort="${launch.effort}"`,
		"-c",
		`sandbox_mode="${launch.permissionMode}"`,
		"-c",
		'approval_policy="never"',
	];
}

const HARNESS: Record<HarnessName, Harness> = { claude, codex };

/** A mistake in the arguments or environment, reported as a usage error. */
export class AgentInputError extends Error {}

/**
 * Variables an agent must not inherit: the coordinating session's harness
 * state and credentials, other keys, and secret-manager tokens. Without them
 * the agent neither reuses the session's account nor acts as its sub-session.
 * A launch from inside a `quest gate` command does not admit the agent's own
 * expensive commands, so the gate's mark is dropped too.
 */
const STRIPPED = [
	/^CLAUDE/,
	/^ANTHROPIC/,
	/^CODEX_(?!HOME$)/,
	/^OPENAI_API_KEY$/,
	/^OP_/,
	/^QUEST_API_KEYS$/,
	/^QUEST_GATE_ADMITTED$/,
];

/** The agent's environment: the user's, minus `STRIPPED`, plus its one key. */
export function agentEnvironment(env: NodeJS.ProcessEnv, variable: string, key: string): NodeJS.ProcessEnv {
	const kept = Object.entries(env).filter(([name]) => !STRIPPED.some((pattern) => pattern.test(name)));
	return { ...Object.fromEntries(kept), [variable]: key };
}

/**
 * Per-user state that should not outlive the login: the runtime directory
 * where one exists, otherwise a user-only directory in the per-user (macOS,
 * Windows) or shared (Linux) temporary directory.
 */
export function agentDirectory(env = process.env): string {
	if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "quest", "agent");
	const uid = process.getuid?.();
	return join(tmpdir(), uid === undefined ? "quest-agent" : `quest-agent-${uid}`);
}

/** Create `dir` readable only by this user, refusing one someone else could read or replace. */
function privateDirectory(dir: string): string {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const uid = process.getuid?.();
	if (uid !== undefined) {
		const stat = statSync(dir);
		if (stat.uid !== uid) throw new Error(`${dir} belongs to another user`);
		if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
	}
	return dir;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

/** One spawn's state: every worktree of a repository shares its key store and agent records. */
export function spawnDirectory(base: string, worktree: string): string {
	let common: string;
	try {
		common = execFileSync("git", ["-C", worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		throw new AgentInputError(`${worktree} is not inside a Git repository`);
	}
	return join(base, digest(realpathSync(common)));
}

function save(path: string, value: unknown): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function load<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

interface KeyStore {
	/** Which `QUEST_API_KEYS` value the keys were resolved from. */
	fingerprint: string;
	keys: string[];
}

/** Resolves secret references to keys in order, in one secret-manager invocation. */
export type Resolver = (references: string[], env: NodeJS.ProcessEnv) => string[];

/**
 * 1Password resolves every `op://` reference in one `op inject`, so the user
 * approves at most one prompt; a service account token makes it promptless.
 */
export const onePassword: Resolver = (references, env) => {
	const template = references.map((reference) => `{{ ${reference} }}`).join("\n");
	let output: string;
	try {
		output = execFileSync("op", ["inject"], {
			encoding: "utf8",
			env,
			input: `${template}\n`,
			stdio: ["pipe", "pipe", "inherit"],
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("op is not installed");
		throw new Error("op inject failed to resolve QUEST_API_KEYS");
	}
	const keys = output.split("\n").slice(0, references.length);
	if (keys.length !== references.length || keys.some((key) => !/^\S+$/.test(key))) {
		throw new Error("op inject did not resolve every QUEST_API_KEYS reference to one key");
	}
	return keys;
};

/**
 * The keys `QUEST_API_KEYS` names, resolved on first use and kept in the
 * spawn's store until `stop --all`. Concurrent launches wait for one resolver.
 */
export async function spawnKeys(dir: string, env: NodeJS.ProcessEnv, resolve: Resolver): Promise<string[]> {
	const entries = (env.QUEST_API_KEYS ?? "").split(/\s+/).filter((entry) => entry !== "");
	if (entries.length === 0) throw new AgentInputError("QUEST_API_KEYS is unset or empty");
	for (const entry of entries) {
		const scheme = /^([a-z][\w+.-]*):\/\//i.exec(entry)?.[1];
		if (scheme !== undefined && scheme !== "op") {
			throw new AgentInputError(`QUEST_API_KEYS has a ${scheme}:// reference; only op:// is supported`);
		}
	}
	const fingerprint = createHash("sha256").update(entries.join("\n")).digest("hex");
	const file = join(dir, "keys.json");
	const lock = join(dir, "resolving");
	for (;;) {
		const stored = load<KeyStore>(file);
		if (stored?.fingerprint === fingerprint) return stored.keys;
		try {
			mkdirSync(lock, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Another launch is resolving; its secret-manager prompt may take a while.
			const owner = Number(load<number>(join(lock, "pid")));
			if (owner > 0 && !alive(owner)) rmSync(lock, { recursive: true, force: true });
			else await sleep(250);
			continue;
		}
		try {
			writeFileSync(join(lock, "pid"), String(process.pid));
			const references = entries.filter((entry) => entry.startsWith("op://"));
			const resolved = references.length > 0 ? resolve(references, env) : [];
			const keys = entries.map((entry) => (entry.startsWith("op://") ? resolved.shift()! : entry));
			save(file, { fingerprint, keys } satisfies KeyStore);
			return keys;
		} finally {
			rmSync(lock, { recursive: true, force: true });
		}
	}
}

/** A live agent, recorded so `stop` can find it by worktree. */
interface Running {
	/** The `quest agent` process that reports the agent's result. */
	pid: number;
	/** The agent CLI process; unset only when it failed to spawn. */
	child?: number;
	worktree: string;
	session?: string;
	/** Set by `stop` before it signals the agent, so the result reads as stopped. */
	stopping?: boolean;
}

const recordPath = (dir: string, worktree: string) => join(dir, "agents", `${digest(worktree)}.json`);

/**
 * Claim `worktree` for this process by creating its record exclusively, so two
 * concurrent launches cannot both run there. A record left by a `quest agent`
 * that died is replaced.
 */
function claim(record: string, worktree: string): void {
	for (;;) {
		try {
			writeFileSync(record, `${JSON.stringify({ pid: process.pid, worktree } satisfies Running)}\n`, {
				flag: "wx",
				mode: 0o600,
			});
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const previous = load<Running>(record);
		if (previous && alive(previous.pid)) {
			throw new Error(`an agent is already running in ${worktree}; stop it with \`quest agent stop\``);
		}
		rmSync(record, { force: true });
	}
}

export interface AgentDependencies {
	env: NodeJS.ProcessEnv;
	/** The state directory, normally `agentDirectory()`. */
	base: string;
	resolve: Resolver;
	stdout(text: string): void;
	stderr(text: string): void;
}

export const processDependencies = (out: Pick<AgentDependencies, "stdout" | "stderr">): AgentDependencies => ({
	env: process.env,
	base: agentDirectory(),
	resolve: onePassword,
	...out,
});

/**
 * Run one agent turn in the foreground: a new session with `prompt`, or
 * `session` resumed with it. Prints the session id as soon as it is known,
 * then the cost, outcome, and final reply. Returns the exit status.
 */
export async function runAgent(
	launch: Launch,
	prompt: string,
	session: string | undefined,
	deps: AgentDependencies,
): Promise<number> {
	let worktree: string;
	try {
		worktree = realpathSync(launch.worktree);
		if (!statSync(worktree).isDirectory()) throw new Error();
	} catch {
		throw new AgentInputError(`${launch.worktree} is not a directory`);
	}
	const dir = spawnDirectory(privateDirectory(deps.base), worktree);
	privateDirectory(join(dir, "agents"));
	const keys = await spawnKeys(dir, deps.env, deps.resolve);
	const key = keys[launch.key - 1];
	if (key === undefined) {
		throw new AgentInputError(`--key ${launch.key} is past the ${keys.length} entries in QUEST_API_KEYS`);
	}
	// Agent output never repeats a key; any that leaks is shown by position.
	const redact = (value: string) =>
		keys.reduce((result, k, index) => result.replaceAll(k, `<key ${index + 1}>`), value);

	const harness = HARNESS[launch.harness];
	const id = session ?? randomUUID();
	const argv = session === undefined ? harness.start(launch, id) : harness.resume(launch, id);
	// Claude Code takes the id this command assigns; Codex announces its own.
	const known = launch.harness === "claude" ? id : session;
	const record = recordPath(dir, worktree);
	claim(record, worktree);

	let announced: string | undefined;
	const announce = (value: string | undefined) => {
		if (value === undefined || value === announced) return;
		announced = value;
		// Merge, keeping a `stopping` mark that `stop` may have added.
		save(record, { ...load<Running>(record)!, session: value });
		deps.stdout(`session ${value}\n`);
	};

	const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
	let interrupted = 0;
	let child: ChildProcess | undefined;
	const forward = (name: (typeof signals)[number]) => {
		interrupted ||= 128 + constants.signals[name];
		child?.kill(name);
	};
	const handlers = signals.map((name) => [name, () => forward(name)] as const);
	for (const [name, handler] of handlers) process.on(name, handler);
	try {
		const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>(
			(resolve, reject) => {
				const agent = spawn(argv[0], argv.slice(1), {
					cwd: worktree,
					env: agentEnvironment(deps.env, harness.keyVariable, key),
					stdio: ["pipe", "pipe", "pipe"],
				});
				child = agent;
				// `stop` waits for the agent's pid before it marks the record, so this write loses nothing.
				save(record, { pid: process.pid, child: agent.pid, worktree } satisfies Running);
				announce(known);
				let out = "";
				let err = "";
				let line = "";
				// Stderr is forwarded by whole lines: a key never spans a newline, so
				// one split across chunks is still redacted.
				let partial = "";
				agent.stdout.setEncoding("utf8").on("data", (chunk: string) => {
					out += chunk;
					const lines = (line + chunk).split("\n");
					line = lines.pop()!;
					for (const complete of lines) announce(harness.announced(complete));
				});
				agent.stderr.setEncoding("utf8").on("data", (chunk: string) => {
					err += chunk;
					const buffered = partial + chunk;
					const end = buffered.lastIndexOf("\n") + 1;
					partial = buffered.slice(end);
					if (end > 0) deps.stderr(redact(buffered.slice(0, end)));
				});
				agent.stderr.once("end", () => {
					if (partial !== "") deps.stderr(redact(partial));
				});
				agent.stdin.on("error", () => {}); // An agent that exits early closes its stdin.
				agent.stdin.end(prompt);
				agent.once("error", (error: NodeJS.ErrnoException) =>
					reject(error.code === "ENOENT" ? new Error(`${argv[0]} is not installed`) : error),
				);
				agent.once("close", (status, signal) =>
					resolve({
						code: status ?? (signal ? 128 + constants.signals[signal] : 1),
						stdout: out,
						stderr: err,
					}),
				);
			},
		);
		const result = harness.parse(stdout, stderr);
		announce(result.session);
		const outcome: Outcome =
			interrupted || load<Running>(record)?.stopping
				? "stopped"
				: result.exhausted
					? "exhausted"
					: code === 0 && !result.failed
						? "finished"
						: "failed";
		if (outcome === "failed" && result.reply === undefined && stdout.trim() !== "") {
			deps.stderr(`quest: ${argv[0]} printed no result; its output was:\n${redact(stdout)}\n`);
		}
		if (result.cost !== undefined) deps.stdout(`cost ${result.cost}\n`);
		deps.stdout(`outcome ${outcome}\n`);
		if (result.reply !== undefined) deps.stdout(`\n${redact(result.reply)}\n`);
		return interrupted || EXIT[outcome];
	} finally {
		for (const [name, handler] of handlers) process.off(name, handler);
		rmSync(record, { force: true });
	}
}

/** How long a stopped agent has to exit before it is killed. */
export const STOP_GRACE_MS = 10_000;

/** Stop the agent running in `worktree`, waiting until its `quest agent` process has reported. */
export async function stopAgent(worktree: string, deps: AgentDependencies): Promise<void> {
	let path: string;
	try {
		path = realpathSync(worktree);
	} catch {
		throw new AgentInputError(`${worktree} is not a directory`);
	}
	const dir = spawnDirectory(deps.base, path);
	await stopRecord(recordPath(dir, path), deps);
}

async function stopRecord(record: string, deps: AgentDependencies): Promise<void> {
	let running = load<Running>(record);
	// A launch records its agent's pid just after claiming the worktree.
	while (running !== undefined && running.child === undefined && alive(running.pid)) {
		await sleep(100);
		running = load<Running>(record);
	}
	if (running === undefined || !alive(running.pid)) {
		rmSync(record, { force: true });
		deps.stdout(`no agent running${running ? ` in ${running.worktree}` : ""}\n`);
		return;
	}
	save(record, { ...running, stopping: true });
	const { pid, child, worktree } = running;
	// Signal the agent CLI, never the reporting process, which then prints the
	// stopped outcome and removes the record.
	const signal = (name: NodeJS.Signals) => {
		try {
			if (child !== undefined) process.kill(child, name);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	};
	signal("SIGTERM");
	const deadline = Date.now() + STOP_GRACE_MS;
	let killed = false;
	let session = running.session;
	for (let current = running; alive(pid);) {
		session = current.session ?? session;
		if (!killed && Date.now() > deadline) {
			signal("SIGKILL");
			killed = true;
		}
		await sleep(100);
		const next = load<Running>(record);
		if (next === undefined) break;
		current = next;
	}
	rmSync(record, { force: true });
	deps.stdout(`stopped ${worktree}${session ? ` session ${session}` : ""}\n`);
}

/** End the spawn for the repository holding `root`: stop every agent, then delete the resolved keys. */
export async function stopAll(root: string, deps: AgentDependencies): Promise<void> {
	const dir = spawnDirectory(deps.base, root);
	const agents = join(dir, "agents");
	let names: string[] = [];
	try {
		names = readdirSync(agents).filter((name) => name.endsWith(".json"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	for (const name of names) await stopRecord(join(agents, name), deps);
	rmSync(dir, { recursive: true, force: true });
	deps.stdout("deleted the resolved keys\n");
}
