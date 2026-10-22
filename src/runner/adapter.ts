// How a runner drives one agent CLI. The interface stays small so another
// CLI (opencode) fits it: sign an account in, start or resume a session with
// the kix tools attached, stream its raw output, stop it, and read how it ended.
// Questions, checkpoints, and delivery reach kix through those tools, not
// through anything CLI-specific.
import type { AccountKind } from "./home";

export interface Launch {
	/** The job's checkout, where the agent works. */
	cwd: string;
	/** The account's isolated home, which holds its CLI login and sessions. */
	home: string;
	session: string;
	/** Resume `session` rather than starting it. */
	resume: boolean;
	/** The turn's message: the workflow on a new session, or the maintainer's answers on a resumed one. */
	prompt: string;
	/** Standing instructions appended to the CLI's own system prompt. */
	system: string;
	/** The kix tools' MCP endpoint and bearer token. */
	tools: { url: string; token: string };
	/** A command prefix the CLI runs under, such as entering the project's Nix devShell. */
	shell: string[];
	env: NodeJS.ProcessEnv;
	/** Receives each line of the CLI's raw output. */
	output(line: string): void;
}

export interface Exit {
	/** The provider refused the account for its usage limit, until this time if known. */
	limited: { until: number | null } | null;
	/** The turn ended in an error rather than a reply. */
	failed: boolean;
	/** The agent's last reply, or the error it ended with. */
	reply?: string;
}

export interface Running {
	done: Promise<Exit>;
	/** Ask the CLI to stop, killing it after a grace period. */
	stop(): void;
}

export interface SignedIn {
	kind: AccountKind;
	/** A label for the account, such as its email. */
	label: string;
}

export interface Adapter {
	readonly name: "claude";
	/** The provider kix shows for this adapter's accounts. */
	readonly provider: string;
	/** Run the CLI's own interactive sign-in in `home`. */
	login(home: string, options: { console: boolean }): Promise<void>;
	/** Whether `home` holds a signed-in account, and what kind. */
	status(home: string): Promise<SignedIn | null>;
	launch(launch: Launch): Running;
}
