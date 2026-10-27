// The `land` environment holds the key of the App that main's ruleset lets bypass it.

import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

const WORKFLOWS = ".github/workflows";

/** The `workflow:job` of every job that names the `land` environment. */
function landEnvironments(name: string, text: string): string[] {
	const users: string[] = [];
	let job: string | undefined;
	// Whether the previous line opened an `environment:` mapping, whose `name:` follows.
	let mapping = false;
	for (const line of text.split("\n")) {
		// Jobs sit two spaces under the top-level `jobs:`.
		const header = /^ {2}([\w-]+):\s*$/.exec(line);
		if (header) job = header[1];
		const named = mapping && /^\s*name:\s*['"]?land['"]?\s*$/.test(line);
		if (named || /^\s*environment:.*\bland\b/.test(line)) users.push(`${name}:${job ?? "workflow"}`);
		mapping = /^\s*environment:\s*$/.test(line);
	}
	return users;
}

test("only the Land workflow's land job uses the land environment", () => {
	const users = readdirSync(WORKFLOWS)
		.filter((name) => /\.ya?ml$/.test(name))
		.flatMap((name) => landEnvironments(name, readFileSync(`${WORKFLOWS}/${name}`, "utf8")));
	expect(users).toEqual(["land.yml:land"]);
});

test.each([
	["a job", "jobs:\n  build:\n    environment: land\n", ["ci.yml:build"]],
	["the mapping form", "jobs:\n  build:\n    environment:\n      name: land\n", ["ci.yml:build"]],
	["another environment", "jobs:\n  build:\n    environment: release\n", []],
])("finds the land environment in %s", (_, text, users) => {
	expect(landEnvironments("ci.yml", text)).toEqual(users);
});
