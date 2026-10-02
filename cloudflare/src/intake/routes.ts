import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireActor } from "../auth";
import { claimMarkdownName } from "./claim";
import { ownedFork } from "./forks";
import { getRepository, IntakeError, type Repository } from "./registry";

export function intakeRoutes(app: Hono<{ Bindings: Env }>) {
	app.use("/repositories/*", bodyLimit({ maxSize: 8192 }));
	app.use("/repositories", bodyLimit({ maxSize: 8192 }));
	for (const route of ["/repositories", "/repositories/*"]) {
		app.use(route, async (c, next) => {
			c.header("Cache-Control", "no-store");
			if (!["GET", "HEAD"].includes(c.req.method) && c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin)
				return c.json({ error: "Invalid origin" }, 403);
			await next();
		});
	}
	app.get("/repositories", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const result = await c.env.DB.prepare(
			"SELECT name, remote, defaultBranch, maintainerId FROM repositories ORDER BY name",
		).all<Repository>();
		return c.json({
			identity: `${actor.provider}:${actor.identity}`,
			repositories: result.results.map((repository) => ({
				name: repository.name,
				remote: repository.remote,
				maintainer: repository.maintainerId === actor.userId,
			})),
		});
	});
	app.post("/repositories", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		if (
			!c.env.AUTH_MAINTAINERS.split(",")
				.map((value) => value.trim())
				.includes(`${actor.provider}:${actor.identity}`)
		)
			throw new IntakeError(403, "Operator registration required");
		const { name } = await c.req.json<{ name?: unknown }>();
		if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))
			throw new IntakeError(400, "Invalid repository name");
		return c.json(await c.env.REPOSITORIES.getByName(name).register(name, actor));
	});
	app.post("/repositories/:name/fork", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers),
			name = c.req.param("name");
		const fork = await c.env.REPOSITORIES.getByName(name).createFork(name, actor);
		using repo = await c.env.ARTIFACTS.get(fork.forkName);
		const token = await repo.createToken("write", 86400);
		return c.json({
			fork: fork.forkName,
			remote: fork.remote,
			token,
			claim: `## Claim\n\n- ${claimMarkdownName(fork.name)} (${fork.provider}:${fork.identity}) on ${fork.remote} since ${new Date().toISOString().slice(0, 10)}\n`,
		});
	});
	app.post("/repositories/:name/tokens", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const fork = await ownedFork(c.env, c.req.param("name"), actor);
		using repo = await c.env.ARTIFACTS.get(fork.forkName);
		return c.json(await repo.createToken("write", 86400));
	});
	app.get("/repositories/:name/tokens", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const fork = await ownedFork(c.env, c.req.param("name"), actor);
		using repo = await c.env.ARTIFACTS.get(fork.forkName);
		return c.json(await repo.listTokens());
	});
	app.delete("/repositories/:name/tokens/:id", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const fork = await ownedFork(c.env, c.req.param("name"), actor);
		using repo = await c.env.ARTIFACTS.get(fork.forkName);
		return c.json({ revoked: await repo.revokeToken(c.req.param("id")) });
	});
	app.post("/repositories/:name/release", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const name = c.req.param("name");
		await getRepository(c.env.DB, name);
		const { path } = await c.req.json<{ path?: unknown }>();
		if (typeof path !== "string" || !/^quest\/.+\.md$/.test(path)) throw new IntakeError(400, "Invalid quest path");
		return c.json(await c.env.REPOSITORIES.getByName(name).release(name, path, actor.userId));
	});
}
