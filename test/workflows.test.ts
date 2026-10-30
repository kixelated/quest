// token.moq.dev issues the moq-bot token that main's ruleset lets bypass it to
// whichever job of main's land.yml asks with a GitHub ID token, so only the
// land job, which runs no queued PR's code, may request one.

import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

const WORKFLOWS = ".github/workflows";

/** The `workflow:job` of every job, or `workflow:workflow` for the top level, that may request an ID token. */
function idTokenUsers(name: string, text: string): string[] {
	const users: string[] = [];
	let job: string | undefined;
	for (const line of text.split("\n")) {
		// Jobs sit two spaces under the top-level `jobs:`.
		const header = /^ {2}([\w-]+):\s*$/.exec(line);
		if (header) job = header[1];
		// `write-all` grants id-token too.
		if (/\bid-token:\s*write\b|\bpermissions:\s*write-all\b/.test(line)) users.push(`${name}:${job ?? "workflow"}`);
	}
	return users;
}

test("only the Land workflow's land job may request an ID token", () => {
	const users = readdirSync(WORKFLOWS)
		.filter((name) => /\.ya?ml$/.test(name))
		.flatMap((name) => idTokenUsers(name, readFileSync(`${WORKFLOWS}/${name}`, "utf8")));
	expect(users).toEqual(["land.yml:land"]);
});

test.each([
	["a job's mapping", "jobs:\n  build:\n    permissions:\n      id-token: write\n", ["ci.yml:build"]],
	[
		"a job's flow mapping",
		"jobs:\n  build:\n    permissions: { contents: read, id-token: write }\n",
		["ci.yml:build"],
	],
	["the top level", "permissions:\n  id-token: write\njobs:\n  build:\n", ["ci.yml:workflow"]],
	["write-all", "jobs:\n  build:\n    permissions: write-all\n", ["ci.yml:build"]],
	["a read grant", "jobs:\n  build:\n    permissions:\n      id-token: read\n", []],
])("finds an ID token grant in %s", (_, text, users) => {
	expect(idTokenUsers("ci.yml", text)).toEqual(users);
});
