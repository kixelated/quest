import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { gate, systemd } from "../src/cli/gate";
import { tempDir } from "./fixture";

afterEach(() => vi.unstubAllEnvs());

test.skipIf(process.platform !== "linux").each([
	{ client: 253, manager: 261, failure: "old client", probe: false },
	{ client: 261, manager: 253, failure: "old manager", probe: false },
	{ client: 254, manager: 254, failure: "cgroup.kill: No such file or directory", probe: true },
	{ client: 261, manager: 261, failure: "cgroup.kill: Permission denied", probe: true },
])("falls back before the user command when systemd lacks $failure", async ({ client, manager, failure, probe }) => {
	const runtime = tempDir();
	mkdirSync(join(runtime, "systemd"));
	writeFileSync(join(runtime, "systemd/private"), "");
	const bin = tempDir();
	const log = join(bin, "calls");
	writeFileSync(
		join(bin, "systemd-run"),
		`#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = --version ]; then printf 'systemd ${client}\\n'; exit 0; fi
printf '%s\\n' '${failure}' >&2
exit 125
`,
		{ mode: 0o755 },
	);
	writeFileSync(join(bin, "systemctl"), `#!/bin/sh\nprintf '${manager}\\n'\n`, { mode: 0o755 });
	vi.stubEnv("XDG_RUNTIME_DIR", runtime);
	vi.stubEnv("PATH", bin);
	// The command is already admitted by the portable backend. This keeps the
	// fallback regression independent of real host load and admission windows.
	vi.stubEnv("QUEST_GATE_ADMITTED", "1");
	expect(await systemd(new AbortController().signal)).toBe(false);
	expect(await gate([process.execPath, "-e", "process.exit(23)"])).toBe(23);
	const calls = readFileSync(log, "utf8");
	expect(calls.includes("--scope")).toBe(probe);
	if (probe) expect(calls).toContain("quest-gate-probe-");
});
