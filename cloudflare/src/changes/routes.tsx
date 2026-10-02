import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireActor } from "../auth";
import { GitConflict } from "../git";
import { getRepository, requireFork, requireMaintainer, IntakeError } from "../intake/registry";
import { hasApproval, hasCheck, inspectChange, type ChangeIdentity, type ChangeMutation } from "../mutations";
import { dispatchChangeCheck } from "./workflow";

export const changesRoutes = new Hono<{ Bindings: Env }>();
changesRoutes.use("/repos/*", bodyLimit({ maxSize: 32_768 }));
changesRoutes.onError((error, c) => {
	if (error instanceof IntakeError) return c.text(error.message, error.status);
	if (error instanceof GitConflict) return c.text(error.message, 409);
	console.error({ event: "change_failed", name: error.name });
	return c.text("Could not load change", 500);
});

function link(identity: ChangeIdentity): string {
	return `/repos/${encodeURIComponent(identity.repositoryName)}/changes/${encodeURIComponent(identity.forkName)}?${new URLSearchParams({ branch: identity.branch, head: identity.head })}`;
}
function fields(identity: ChangeIdentity, base: string, tree: string | null) {
	return (
		<>
			<input type="hidden" name="branch" value={identity.branch} />
			<input type="hidden" name="head" value={identity.head} />
			<input type="hidden" name="expectedHead" value={base} />
			<input type="hidden" name="checkedTree" value={tree ?? ""} />
			<input type="hidden" name="operationId" value={crypto.randomUUID()} />
		</>
	);
}

changesRoutes.get("/repos/:repository/changes", async (c) => {
	const actor = await requireActor(c.env, c.req.raw.headers);
	const repository = await requireMaintainer(c.env.DB, c.req.param("repository"), actor.userId);
	const changes = await c.env.DB.prepare(
		"SELECT repositoryName, forkName, branch, head FROM changes WHERE repositoryName = ? ORDER BY updatedAt DESC",
	)
		.bind(repository.name)
		.all<ChangeIdentity>();
	c.header("Cache-Control", "no-store");
	return c.html(
		<html lang="en">
			<head>
				<title>Changes — {repository.name}</title>
			</head>
			<body>
				<h1>{repository.name} changes</h1>
				<ul>
					{changes.results.map((change) => (
						<li>
							<a href={link(change)}>{change.branch}</a> from {change.forkName} ({change.head.slice(0, 8)}
							)
						</li>
					))}
				</ul>
			</body>
		</html>,
	);
});

changesRoutes.get("/repos/:repository/changes/:fork", async (c) => {
	const actor = await requireActor(c.env, c.req.raw.headers);
	const identity: ChangeIdentity = {
		repositoryName: c.req.param("repository"),
		forkName: c.req.param("fork"),
		branch: c.req.query("branch") ?? "",
		head: c.req.query("head") ?? "",
	};
	const repository = await getRepository(c.env.DB, identity.repositoryName);
	const fork = await requireFork(c.env.DB, repository.name, identity.forkName);
	if (actor.userId !== repository.maintainerId && actor.userId !== fork.userId)
		throw new IntakeError(403, "Repository access required");
	const candidate = await inspectChange(c.env, identity);
	if (candidate.merged)
		return c.html(
			<html lang="en">
				<head>
					<title>Merged change</title>
				</head>
				<body>
					<h1>{identity.branch} merged</h1>
					<p>This fork head is already part of upstream main.</p>
					<a href={`/repos/${encodeURIComponent(repository.name)}/changes`}>Changes</a>
				</body>
			</html>,
		);
	const checked = !!candidate.tree && hasCheck(candidate.notes, identity, candidate.upstreamHead, candidate.tree);
	const approved =
		!!candidate.tree &&
		hasApproval(candidate.notes, identity, candidate.upstreamHead, candidate.tree, repository.maintainerId);
	const valid = !candidate.conflicts && !!candidate.result && candidate.result.findings.length === 0;
	const action = `/repos/${encodeURIComponent(repository.name)}/changes/${encodeURIComponent(fork.forkName)}`;
	c.header("Cache-Control", "no-store");
	return c.html(
		<html lang="en">
			<head>
				<title>{identity.branch} — change</title>
			</head>
			<body>
				<h1>{identity.branch}</h1>
				<p>
					Fork head: {identity.head}. Upstream: {candidate.upstreamHead}.
				</p>
				<h2>Quest check</h2>
				<p>
					{candidate.conflicts
						? "Merge conflicts"
						: valid
							? checked
								? "Passed for this head and upstream"
								: "Snapshot valid; push check pending"
							: "Failed"}
				</p>
				<pre>{candidate.conflicts ?? JSON.stringify(candidate.result?.findings ?? [], null, 2)}</pre>
				<form method="post" action={`${action}/check`}>
					{fields(identity, candidate.upstreamHead, candidate.tree)}
					<button>Check again</button>
				</form>
				<h2>Diff</h2>
				<pre>{candidate.patch}</pre>
				<h2>Reviews</h2>
				<ol>
					{candidate.notes.map((note) => (
						<li>
							{note.kind} by {note.actor.name} at {note.time}
							<pre>{note.text}</pre>
						</li>
					))}
				</ol>
				<form method="post" action={`${action}/comment`}>
					{fields(identity, candidate.upstreamHead, candidate.tree)}
					<label>
						Comment <textarea name="text" required maxlength={20_000} />
					</label>
					<button>Comment</button>
				</form>
				{actor.userId === repository.maintainerId && (
					<>
						<form method="post" action={`${action}/approve`}>
							{fields(identity, candidate.upstreamHead, candidate.tree)}
							<button disabled={!valid || !checked}>Approve this head</button>
						</form>
						<form method="post" action={`${action}/merge`}>
							{fields(identity, candidate.upstreamHead, candidate.tree)}
							<button disabled={!valid || !checked || !approved}>Merge this head</button>
						</form>
					</>
				)}
			</body>
		</html>,
	);
});

changesRoutes.post("/repos/:repository/changes/:fork/:action", async (c) => {
	if (c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin)
		throw new IntakeError(403, "Same-origin request required");
	const actor = await requireActor(c.env, c.req.raw.headers);
	const body = await c.req.parseBody();
	const text = (name: string) => (typeof body[name] === "string" ? (body[name] as string) : "");
	const identity: ChangeIdentity = {
		repositoryName: c.req.param("repository"),
		forkName: c.req.param("fork"),
		branch: text("branch"),
		head: text("head"),
	};
	const repository = await getRepository(c.env.DB, identity.repositoryName);
	const fork = await requireFork(c.env.DB, repository.name, identity.forkName);
	const action = c.req.param("action");
	if (action === "check") {
		if (actor.userId !== repository.maintainerId && actor.userId !== fork.userId)
			throw new IntakeError(403, "Repository access required");
		await dispatchChangeCheck(c.env, identity);
	} else {
		if (action !== "comment" && action !== "approve" && action !== "merge")
			throw new IntakeError(404, "Unknown action");
		const common = { ...identity, userId: actor.userId, operationId: text("operationId") };
		const request: ChangeMutation =
			action === "comment"
				? { ...common, kind: action, text: text("text") }
				: { ...common, kind: action, expectedHead: text("expectedHead"), checkedTree: text("checkedTree") };
		await c.env.REPOSITORIES.getByName(repository.name).mutate(request);
	}
	return c.redirect(
		action === "merge" ? `/repos/${encodeURIComponent(repository.name)}/changes` : link(identity),
		303,
	);
});
