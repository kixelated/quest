// The opencode adapter. It runs the unmodified `opencode` binary as a headless
// `opencode serve` on localhost behind a per-launch password and drives one
// session through its SDK: each turn is one prompt, and the session's events
// stream as raw output. Each account signs in with opencode's own
// `auth login` in its own XDG home; the runner reads only which providers that
// home signed in to, never the credentials. The kix tools attach as a remote
// MCP server, and opencode's question tool is denied so every question goes
// through kix's `ask` instead.
//
// opencode has no sandbox of its own, and the runner does not yet wrap it in
// one: its commands run on the host, in the devShell the runner built from the
// job's revision and with the attempt's private HOME, but not confined to the
// checkout.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	type AssistantMessage,
	createOpencodeClient,
	type Event,
	type Part,
	type SessionStatus,
} from "@opencode-ai/sdk/v2/client";

import { boundedLines, LINE_LIMIT } from "../cli/agent";
import {
	type Adapter,
	baseEnvironment,
	type Exit,
	type Launch,
	type Running,
	type SignedIn,
	signalGroup,
	STOP_GRACE_MS,
} from "./adapter";

/** The XDG base directories opencode keeps its config, credentials, sessions, and caches in, with their defaults. */
const XDG = {
	XDG_CONFIG_HOME: ".config",
	XDG_DATA_HOME: join(".local", "share"),
	XDG_CACHE_HOME: ".cache",
	XDG_STATE_HOME: join(".local", "state"),
} as const;

/** An account's own XDG directories, under its home. */
export function accountDirectories(home: string): Record<keyof typeof XDG, string> {
	return {
		XDG_CONFIG_HOME: join(home, "config"),
		XDG_DATA_HOME: join(home, "data"),
		XDG_CACHE_HOME: join(home, "cache"),
		XDG_STATE_HOME: join(home, "state"),
	};
}

/**
 * Variables opencode would read in place of the account's own sign-in: the
 * user's opencode settings, and provider credentials, which some providers
 * prefer over a stored key. Matched by name, since every provider names its own.
 */
const UNSET = [
	/^OPENCODE_/,
	/_(API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_KEY(_ID)?|SECRET_ACCESS_KEY|SESSION_TOKEN)$/,
	/BEARER_TOKEN/,
];

/** The user's environment for opencode, so only the account's sign-in pays for its jobs. */
export function environment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(baseEnvironment(env)).filter(([name]) => !UNSET.some((pattern) => pattern.test(name))),
	);
}

/** The model the account picked with `--model`, from its own opencode config. */
function accountModel(home: string): string | undefined {
	try {
		const { model } = JSON.parse(readFileSync(modelConfig(home), "utf8")) as { model?: unknown };
		return typeof model === "string" ? model : undefined;
	} catch {
		return undefined;
	}
}

function modelConfig(home: string): string {
	return join(accountDirectories(home).XDG_CONFIG_HOME, "opencode", "opencode.json");
}

/**
 * The XDG directories the agent's commands get back: the user's, so tools
 * such as nix and git read their usual config rather than the account's.
 */
function userDirectories(env: NodeJS.ProcessEnv): Record<string, string> {
	const home = env.HOME || homedir();
	return Object.fromEntries(Object.entries(XDG).map(([name, fallback]) => [name, env[name] || join(home, fallback)]));
}

/**
 * An opencode plugin that gives the agent's commands the user's XDG
 * directories back, since opencode passes its own environment to them.
 */
const PLUGIN = `export default {
	id: "quest-runner",
	server: async (_input, options) => ({
		"shell.env": async (_context, output) => {
			Object.assign(output.env, options.env);
		},
	}),
};
`;

export interface Credential {
	/** opencode's provider ID, such as openai or opencode-go. */
	provider: string;
	/** How it signed in: oauth for a plan login, api for a key. */
	type: string;
}

/** Which providers an account's home signed in to, from opencode's credential file, without the credentials. */
export function credentials(home: string): Credential[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			readFileSync(join(accountDirectories(home).XDG_DATA_HOME, "opencode", "auth.json"), "utf8"),
		);
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object") return [];
	return Object.entries(parsed).flatMap(([provider, value]) => {
		const type = (value as { type?: unknown } | null)?.type;
		return typeof type === "string" ? [{ provider: provider.replace(/\/+$/, ""), type }] : [];
	});
}

/** What kix shows for a credential, and whether it is a plan rather than a metered key. */
function describe({ provider, type }: Credential): { name: string; plan: boolean } {
	if (provider === "openai" && type === "oauth") return { name: "ChatGPT", plan: true };
	if (provider === "opencode-go") return { name: "OpenCode Go", plan: true };
	if (type === "oauth") return { name: provider, plan: true };
	return { name: `${provider} API key`, plan: false };
}

/** An account that signed in to any provider, labelled by them all. */
export function signedIn(found: Credential[]): SignedIn | null {
	if (!found.length) return null;
	const described = found.map(describe);
	return {
		// kix accepts letters, digits, `-`, and `_`; custom provider IDs may hold more.
		provider: found[0]!.provider.replace(/[^\w-]/g, "-").slice(0, 64),
		kind: described.some((d) => d.plan) ? "subscription" : "api-key",
		label: `${described.map((d) => d.name).join(", ")} (opencode)`,
	};
}

/** Messages a provider sends when the plan or key cannot pay for more, as opposed to a brief rate limit. */
const LIMIT =
	/usage limit|usage_limit_reached|insufficient_quota|quota exceeded|exceeded your current quota|free usage exceeded/i;

/**
 * Whether a retry opencode is waiting on is an account limit: an OpenCode Go
 * limit retries when it resets, and other limits only say so in the message.
 * opencode would otherwise wait until the reset, however far off.
 */
export function retryLimit(status: SessionStatus): Exit["limited"] {
	if (status.type !== "retry") return null;
	if (status.action?.reason === "account_rate_limit") return { until: status.next };
	if (status.action?.reason === "free_tier_limit" || LIMIT.test(status.message)) return { until: null };
	return null;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** When a limit resets, from a ChatGPT-style error body or a `retry-after` header. */
function resets(body: string | undefined, headers: Record<string, string> | undefined, now: number): number | null {
	let error: Record<string, unknown> | undefined;
	try {
		error = object(object(JSON.parse(body ?? ""))?.error);
	} catch {}
	if (typeof error?.resets_at === "number") return error.resets_at * 1000;
	if (typeof error?.resets_in_seconds === "number") return now + error.resets_in_seconds * 1000;
	const after = Number(headers?.["retry-after"]);
	return after > 0 ? now + after * 1000 : null;
}

/** How a turn ended, from its last assistant message and any limit seen while it ran. */
export function turnExit(
	info: AssistantMessage | undefined,
	parts: Part[],
	limited: Exit["limited"],
	now = Date.now(),
): Exit {
	const error = info?.error;
	if (!limited && error?.name === "APIError") {
		const { message, responseBody, responseHeaders } = error.data;
		if (LIMIT.test(`${message}\n${responseBody ?? ""}`))
			limited = { until: resets(responseBody, responseHeaders, now) };
	}
	const text = parts
		.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
		.join("\n")
		.trim();
	const message = (error?.data as { message?: unknown } | undefined)?.message;
	return {
		limited,
		failed: !info || error !== undefined,
		reply: text || (typeof message === "string" ? message : error?.name),
	};
}

export class Opencode implements Adapter {
	readonly name = "opencode";

	/** `binary` is an absolute path, resolved before entering a devShell that could shadow it. */
	constructor(
		readonly binary: string,
		readonly env: NodeJS.ProcessEnv = process.env,
	) {}

	/** opencode's own sign-in, which asks for the provider and how to sign in to it. */
	async login(home: string): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(this.binary, ["auth", "login"], {
				env: { ...environment(this.env), ...accountDirectories(home) },
				stdio: "inherit",
			});
			child.once("error", reject);
			child.once("close", (code) =>
				code === 0 ? resolve() : reject(new Error(`opencode auth login exited ${code}`)),
			);
		});
	}

	async status(home: string): Promise<SignedIn | null> {
		return signedIn(credentials(home));
	}

	/** Pick the account's model in its own opencode config, which applies to every job it runs. */
	static setModel(home: string, model: string): void {
		const file = modelConfig(home);
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		writeFileSync(file, `${JSON.stringify({ model }, null, "\t")}\n`, { mode: 0o600 });
	}

	launch(launch: Launch): Running {
		const password = randomBytes(32).toString("base64url");
		// Kept in the account's private home: a session ID per kix session, and the per-launch plugin.
		const sessions = join(launch.home, "kix-sessions");
		const plugin = join(launch.home, `kix-${launch.session}.js`);
		writeFileSync(plugin, PLUGIN, { mode: 0o600 });
		const model = accountModel(launch.home);
		const config = {
			// The account's pick outranks a project's own opencode.json, which loads after the account's config.
			...(model && { model }),
			autoupdate: false,
			share: "disabled",
			// Only what the account signed in to, not keys the user's environment happens to hold.
			enabled_providers: credentials(launch.home).map((c) => c.provider),
			permission: { "*": "allow", question: "deny" },
			mcp: {
				kix: {
					type: "remote",
					url: launch.tools.url,
					headers: { Authorization: `Bearer ${launch.tools.token}` },
					oauth: false,
				},
			},
			plugin: [[pathToFileURL(plugin).href, { env: userDirectories(launch.env) }]],
		};
		// The account's XDG directories apply to opencode alone: the devShell's nix reads the user's.
		const xdg = Object.entries(accountDirectories(launch.home)).map(([name, dir]) => `${name}=${dir}`);
		// The sandbox's script sets the private HOME and enters the devShell before opencode starts.
		const argv = [
			"/bin/sh",
			"-c",
			'. "$0" && exec "$@"',
			launch.sandbox.env,
			"/usr/bin/env",
			...xdg,
			this.binary,
			"serve",
			"--hostname=127.0.0.1",
			"--port=0",
		];
		// The password and the tools' bearer token stay out of the command line, which other users can read.
		const child = spawn(argv[0]!, argv.slice(1), {
			cwd: launch.cwd,
			env: {
				...environment(launch.env),
				TMPDIR: launch.sandbox.tmp,
				OPENCODE_SERVER_PASSWORD: password,
				OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
			},
			stdio: ["ignore", "pipe", "pipe"],
			// Its own process group, so stopping it also stops the devShell and every tool it started.
			detached: true,
		});

		let stderr = "";
		let listening: (url: string | null) => void = () => {};
		const url = new Promise<string | null>((resolve) => (listening = resolve));
		const lines = boundedLines(LINE_LIMIT, (line) => {
			const found = /^opencode server listening on (http:\/\/\S+)/.exec(line);
			if (found) listening(found[1]!);
		});
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			lines.data(chunk);
			launch.output(chunk);
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-64 * 1024);
			launch.output(chunk);
		});
		const closed = new Promise<void>((resolve) => {
			child.once("error", (error) => {
				stderr += `could not start ${argv[0]}: ${error.message}\n`;
				resolve();
			});
			child.once("close", () => resolve());
		});
		void closed.then(() => listening(null));

		let stopping = false;
		let killer: ReturnType<typeof setTimeout> | undefined;
		let abort: () => Promise<unknown> = async () => {};
		let watched: Promise<void> = Promise.resolve();
		const tail = () => stderr.trim().split("\n").slice(-20).join("\n");
		const failure = (reply: string): Exit => ({ limited: null, failed: true, reply: reply || undefined });

		const turn = async (): Promise<Exit> => {
			const base = await url;
			if (!base) return failure(tail());
			const client = createOpencodeClient({
				baseUrl: base,
				directory: launch.cwd,
				headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
			});
			let session: string | undefined;
			if (launch.resume) {
				try {
					session = readFileSync(join(sessions, launch.session), "utf8").trim();
				} catch {
					return failure(`opencode has no session for ${launch.session} in this account`);
				}
			} else {
				const created = await client.session.create({});
				if (!created.data)
					return failure(`opencode could not create a session: ${JSON.stringify(created.error)}`);
				session = created.data.id;
				mkdirSync(sessions, { recursive: true, mode: 0o700 });
				writeFileSync(join(sessions, launch.session), session, { mode: 0o600 });
			}
			abort = () => client.session.abort({ sessionID: session });
			if (stopping) return failure("stopped");

			let limited: Exit["limited"] = null;
			let connected: () => void = () => {};
			const ready = new Promise<void>((resolve) => (connected = resolve));
			const ignore = () => {};
			// The stream ends when the server stops; aborting it instead leaves the SDK an unhandled rejection.
			watched = (async () => {
				const { stream } = await client.event.subscribe({}, { sseMaxRetryAttempts: 1 });
				for await (const event of stream as AsyncIterable<Event>) {
					connected();
					const { properties } = event as { properties: { sessionID?: string } };
					// Token deltas repeat what the finished parts carry; other sessions' events are not this job's.
					if (properties.sessionID !== session || event.type.endsWith(".delta")) continue;
					launch.output(`${JSON.stringify(event)}\n`);
					if (event.type === "session.status") {
						const hit = retryLimit(event.properties.status);
						if (hit && !limited) {
							limited = hit;
							abort().catch(ignore);
						}
					} else if (event.type === "permission.asked") {
						// Every tool is allowed, as Claude Code's bypassPermissions; a project's own rules may still ask.
						client.permission.reply({ requestID: event.properties.id, reply: "once" }).catch(ignore);
					} else if (event.type === "question.asked") {
						client.question.reject({ requestID: event.properties.id }).catch(ignore);
					}
				}
			})()
				.catch(ignore)
				.finally(connected);
			await ready;
			const reply = await client.session.prompt({
				sessionID: session,
				system: launch.system,
				parts: [{ type: "text", text: launch.prompt }],
			});
			if (!reply.data)
				return { ...failure(`opencode refused the prompt: ${JSON.stringify(reply.error)}`), limited };
			return turnExit(reply.data.info, reply.data.parts, limited);
		};

		const done = turn()
			// The server's own last words explain a lost connection better than the client's error.
			.catch((error: unknown) => failure(tail() || (error instanceof Error ? error.message : String(error))))
			.then(async (exit) => {
				signalGroup(child.pid, "SIGTERM");
				killer ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), STOP_GRACE_MS);
				await closed;
				await watched;
				clearTimeout(killer);
				lines.end();
				rmSync(plugin, { force: true });
				return exit;
			});
		return {
			done,
			stop() {
				stopping = true;
				// Abort the turn so opencode records it, then stop the server whether or not it answered.
				abort()
					.catch(() => {})
					.finally(() => signalGroup(child.pid, "SIGTERM"));
				killer ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), STOP_GRACE_MS);
			},
		};
	}
}
