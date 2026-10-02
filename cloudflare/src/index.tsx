export { ChangeChecks } from "./changes/workflow";
import { changesRoutes } from "./changes/routes";
export { GitSandbox } from "./git-sandbox";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createAuth } from "./auth";
import { intakeRoutes } from "./intake/routes";
import { consumePushes } from "./intake/queue";
import { IntakeError } from "./intake/registry";
export { RepositoryCoordinator } from "./repository";
export { QuestCore } from "./core";

const app = new Hono<{ Bindings: Env }>();
app.use(secureHeaders());
app.route("/", changesRoutes);
app.get("/health", (c) => c.json({ status: "ok" }));
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));
intakeRoutes(app);

app.get("/", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	c.header("Cache-Control", "no-store");
	return c.html(
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Quest</title>
			</head>
			<body>
				<main>
					<h1>Quest</h1>
					<p>Plan repository work and collaborate with agents.</p>
					{session ? (
						<>
							<p>Signed in as {session.user.name}.</p>
							<form method="post" action="/sign-out">
								<button>Sign out</button>
							</form>
						</>
					) : (
						<form method="post" action="/sign-in">
							<button>Sign in with GitHub</button>
						</form>
					)}
				</main>
			</body>
		</html>,
	);
});

// The server API bypasses Better Auth's HTTP middleware. Guard form routes
// before calling it; the /api/auth/* handler enforces its own Origin/CSRF checks.
for (const path of ["/sign-in", "/sign-out"]) {
	app.use(path, async (c, next) => {
		if (c.req.header("Origin") !== new URL(c.env.AUTH_URL).origin) {
			return c.json({ error: "Invalid origin" }, 403);
		}
		await next();
	});
}
app.post("/sign-in", async (c) => {
	const response = await createAuth(c.env).api.signInSocial({
		body: { provider: "github", callbackURL: "/" },
		headers: c.req.raw.headers,
		asResponse: true,
	});
	if (!response.ok) return response;
	const result: { url?: string } = await response.json();
	if (!result.url) return c.json({ error: "Sign in unavailable" }, 502);
	const headers = new Headers(response.headers);
	headers.delete("content-type");
	headers.delete("content-length");
	headers.set("Location", result.url);
	headers.set("Cache-Control", "no-store");
	return new Response(null, { status: 303, headers });
});
app.post("/sign-out", async (c) => {
	const response = await createAuth(c.env).api.signOut({
		headers: c.req.raw.headers,
		asResponse: true,
	});
	if (!response.ok) return response;
	const headers = new Headers(response.headers);
	headers.delete("content-type");
	headers.delete("content-length");
	headers.set("Location", "/");
	headers.set("Cache-Control", "no-store");
	return new Response(null, { status: 303, headers });
});
app.onError((error, c) => {
	if (error instanceof IntakeError) return c.json({ error: error.message }, error.status);
	console.error({ event: "request_failed", path: c.req.path, name: error.name });
	return c.json({ error: "Request failed" }, 500);
});
export default { fetch: app.fetch, queue: consumePushes } satisfies ExportedHandler<Env>;
