// Opt in explicitly: these tests require a real Linux systemd user manager.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { openOwnership, scopeHandshake, systemd, SystemdGate } from "../src/cli/gate";
import { tempDir } from "./fixture";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "src/cli/bin.ts");
const runner = join(root, "test/fixtures/gate-run.ts");
const enabled = process.env.QUEST_GATE_SYSTEMD_TESTS === "1";
const signal = () => new AbortController().signal;

// Commands run through the fixture runner, which admits on an idle host: load
// and memory admission are unit-tested, and must not hold these on a busy host.

function child(file: string, args: string[], cwd = root) {
	const process = spawn("bun", [`--config=${join(root, "bunfig.toml")}`, file, ...args], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	process.stdout.setEncoding("utf8");
	process.stderr.setEncoding("utf8");
	process.stdout.on("data", (data: string) => (stdout += data));
	process.stderr.on("data", (data: string) => (stderr += data));
	const exited = once(process, "exit");
	const closed = once(process, "close").then(([code, killed]) => ({ code, killed, stdout, stderr }));
	return { process, exited, closed };
}

function line(process: ChildProcess, expected: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let text = "";
		const data = (chunk: Buffer) => {
			text += chunk.toString();
			if (!text.includes(expected)) return;
			process.stdout!.off("data", data);
			process.off("close", closed);
			resolve();
		};
		const closed = () => reject(new Error(`command exited before ${expected}: ${text}`));
		process.stdout!.on("data", data);
		process.once("close", closed);
	});
}

const hold = (file: string) => `
	const { watch, existsSync } = require('node:fs');
	const path = ${JSON.stringify(file)};
	const watcher = watch(require('node:path').dirname(path), () => {
		if (existsSync(path)) watcher.close();
	});
	if (existsSync(path)) watcher.close();
	console.log('ready');
`;

describe.skipIf(!enabled)("real systemd scope ownership", () => {
	test("the disposable prerequisite scope supports exact ownership", async () => {
		expect(await systemd(signal())).toBe(true);
	});

	test("memory admission respects a real scope budget instead of abundant host memory", async () => {
		const script = `import {linuxMemory, hostLimits} from ${JSON.stringify(join(root, "src/cli/gate.ts"))}; console.log(JSON.stringify({memory: linuxMemory(), limits: hostLimits()}));`;
		const command = spawn(
			"systemd-run",
			[
				"--user",
				"--scope",
				"--quiet",
				"--collect",
				"--expand-environment=no",
				"--property=MemoryMax=256M",
				"bun",
				"-e",
				script,
			],
			{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		command.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
		command.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
		const [code] = await once(command, "close");
		expect(code, stderr).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.memory.total).toBe(256 * 2 ** 20);
		expect(result.memory.available).toBeGreaterThan(0);
		expect(result.memory.available).toBeLessThan(result.memory.total);
		expect(result.limits.memory).toBe(64 * 2 ** 20);
	});

	test("forwards arguments, locale, stdin and exact exit codes across directories", async () => {
		const locale = process.env.LC_ALL ?? null;
		const spawned = child(
			runner,
			[
				JSON.stringify([
					"bun",
					"-e",
					"process.stdin.once('data', data => { console.log(JSON.stringify([process.argv.slice(1), String(data), process.env.LC_ALL])); process.exitCode = 23; });",
					"--",
					"a $b",
					"--help",
					"--root",
					"other",
				]),
			],
			tempDir(),
		);
		spawned.process.stdin.end("hello");
		const result = await spawned.closed;
		expect(result.code, JSON.stringify(result)).toBe(23);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual([["a $b", "--help", "--root", "other"], "hello", locale]);
	});

	test("preserves stdin, stdout and stderr as terminal descriptors", async () => {
		const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
		const gated = JSON.stringify(["/bin/sh", "-c", "test -t 0 && test -t 1 && test -t 2 && echo terminal"]);
		const command = ["bun", runner, gated].map(quote).join(" ");
		const terminal = spawn("script", ["--quiet", "--return", "--command", command, "/dev/null"], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		terminal.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
		const [code] = await once(terminal, "close");
		expect(code).toBe(0);
		expect(stdout).toContain("terminal");
	});

	test("preserves existing output when stderr is redirected to a file", async () => {
		const file = join(tempDir(), "stderr");
		const descriptor = openSync(file, "w");
		writeSync(descriptor, "prefix\n");
		const command = spawn("bun", [runner, JSON.stringify(["bun", "-e", "console.error('stderr')"])], {
			cwd: root,
			stdio: ["ignore", "ignore", descriptor],
		});
		closeSync(descriptor);
		const [code] = await once(command, "close");
		expect(code).toBe(0);
		expect(readFileSync(file, "utf8")).toBe("prefix\nstderr\n");
	});

	test("nested calls keep their existing kernel scope", async () => {
		const script = `console.log(require('node:fs').readFileSync('/proc/self/cgroup', 'utf8').trim()); require('node:child_process').spawnSync('bun', [${JSON.stringify(cli)}, 'gate', 'cat', '/proc/self/cgroup'], {stdio: 'inherit'});`;
		const spawned = child(runner, [JSON.stringify(["bun", "-e", script])]);
		const result = await spawned.closed;
		expect(result.code).toBe(0);
		const scopes = result.stdout.trim().split("\n");
		expect(scopes).toHaveLength(2);
		expect(scopes[0]).toMatch(/\/quest-gate-0\.scope$/);
		expect(scopes[1]).toBe(scopes[0]);
	});

	test("contention waits across directories without launching a second command", async () => {
		const release = join(tempDir(), "release");
		const first = child(runner, [JSON.stringify(["bun", "-e", hold(release)])]);
		try {
			await line(first.process, "ready");
			expect(
				await new SystemdGate().tryRun(0, ["bun", "-e", "throw new Error('must not start')"], signal()),
			).toBeNull();
			const second = child(runner, [JSON.stringify(["bun", "-e", "console.log('second')"])], tempDir());
			writeFileSync(release, "");
			expect((await first.closed).code).toBe(0);
			expect(await second.closed).toMatchObject({ code: 0, stdout: "second\n", stderr: "" });
		} finally {
			writeFileSync(release, "");
			await first.closed;
		}
	});

	test("a crashed supervisor leaves its descendant scope occupied", async () => {
		const release = join(tempDir(), "release");
		const first = child(runner, [JSON.stringify(["bun", "-e", hold(release)])]);
		try {
			await line(first.process, "ready");
			first.process.kill("SIGKILL");
			await first.exited;
			expect(
				await new SystemdGate().tryRun(0, ["bun", "-e", "throw new Error('must not start')"], signal()),
			).toBeNull();
		} finally {
			writeFileSync(release, "");
			await first.closed;
		}
	});

	test("detached descendants retain admission after the command exits", async () => {
		const release = join(tempDir(), "release");
		const first = child(runner, [
			JSON.stringify(["/bin/sh", "-c", '"$@" &', "quest-orphan", "bun", "-e", hold(release)]),
		]);
		try {
			await line(first.process, "ready");
			expect(
				await new SystemdGate().tryRun(0, ["bun", "-e", "throw new Error('must not start')"], signal()),
			).toBeNull();
		} finally {
			writeFileSync(release, "");
			await first.closed;
		}
	});

	test("cancelling a waiter leaves the occupied command alone", async () => {
		const release = join(tempDir(), "release");
		const first = child(runner, [JSON.stringify(["bun", "-e", hold(release)])]);
		try {
			await line(first.process, "ready");
			const controller = new AbortController();
			const waiting = new SystemdGate().wait(0, controller.signal);
			controller.abort();
			await expect(waiting).rejects.toThrow();
			expect(
				await new SystemdGate().tryRun(0, ["bun", "-e", "throw new Error('must not start')"], signal()),
			).toBeNull();
		} finally {
			writeFileSync(release, "");
			await first.closed;
		}
	});

	test("waiting on a slot that was already collected returns to admission", async () => {
		// The occupying scope can exit between a lost claim and the wait.
		await expect(new SystemdGate().wait(999, signal())).resolves.toBeUndefined();
	});

	test("cancellation kills the exact owned cgroup", async () => {
		const spawned = child(runner, [
			JSON.stringify(["bun", "-e", "console.log('ready'); setInterval(() => {}, 1000);"]),
		]);
		await line(spawned.process, "ready");
		spawned.process.kill("SIGTERM");
		expect((await spawned.closed).code).toBe(143);
	});

	test("a dead handshake cannot acquire ownership of a successor in its reused slot", async () => {
		const original = spawn(
			"systemd-run",
			[
				"--user",
				"--scope",
				"--quiet",
				"--collect",
				"--expand-environment=no",
				"--unit=quest-gate-0.scope",
				"/bin/sh",
				"-c",
				scopeHandshake + "exit 0",
			],
			{ stdio: ["ignore", "ignore", "pipe", "ignore", "pipe", "pipe"] },
		);
		const closed = once(original, "close");
		const [record] = await once(original.stdio[4]!, "data");
		const [path, inode] = String(record).trim().split("\t");
		// Hold the buffered record without acknowledging it. Kill and collect
		// the original scope, exactly the pre-admission interleaving in review.
		const killed = spawnSync("systemctl", ["--user", "kill", "--signal=SIGKILL", "quest-gate-0.scope"]);
		expect(killed.status, killed.stderr.toString()).toBe(0);
		await closed;
		await new SystemdGate().wait(0, signal());
		const release = join(tempDir(), "release");
		const successor = child(runner, [JSON.stringify(["bun", "-e", hold(release)])]);
		try {
			await line(successor.process, "ready");
			expect(() => openOwnership(join("/sys/fs/cgroup", path, "cgroup.kill"), BigInt(inode))).toThrow(
				"exited before admission",
			);
			expect(await new SystemdGate().tryRun(0, ["/bin/sh", "-c", ":"], signal())).toBeNull();
		} finally {
			writeFileSync(release, "");
			await successor.closed;
		}
	});
});
