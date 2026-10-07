import { type Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth } from "./auth";
import { type Board, findDoc as findQuest, readBoard } from "./board/model";
import { BoardPage, QuestPage, SHOWN, questCrumbs } from "./board/pages";
import { type Project, findProject } from "./board/project";
import { DocIndex, DocPage, findDoc } from "./docs";
import { Home } from "./home";
import { Layout, type Page, type User } from "./layout";
export { RepositoryCoordinator } from "./repository";

const app = new Hono<{ Bindings: Env }>();
// Browsers send `Origin: null` on form posts under the default "no-referrer"
// policy, which would fail the origin check on /sign-in and /sign-out.
app.use(secureHeaders({ referrerPolicy: "same-origin" }));
app.get("/health", (c) => c.json({ status: "ok" }));
// Short link for the one-line setup paste.
app.get("/setup", (c) => c.redirect("https://github.com/kixelated/quest/blob/main/SETUP.md"));
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// Every HTML page renders in the shared layout, with the visitor's session in the nav.
async function page(
	c: Context<{ Bindings: Env }>,
	props: Omit<Page, "origin" | "path" | "user">,
	body: Child | ((user: User | null) => Child),
	status: ContentfulStatusCode = 200,
) {
	const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
	const user = session?.user ?? null;
	c.header("Cache-Control", "no-store");
	return c.html(
		<Layout {...props} origin={new URL(c.env.AUTH_URL).origin} path={c.req.path} user={user}>
			{typeof body === "function" ? body(user) : body}
		</Layout>,
		status,
	);
}

app.get("/", (c) =>
	page(
		c,
		{ description: "Readable plans, explicit dependencies, and reviewable Git changes, for you and your agents." },
		<Home setup={new URL("/setup", c.env.AUTH_URL).href} />,
	),
);
app.get("/docs", (c) => page(c, { title: "Docs", description: "How to use Quest in your repository." }, <DocIndex />));
app.get("/docs/:slug", (c) => {
	const doc = findDoc(c.req.param("slug"));
	if (!doc) return c.notFound();
	return page(c, { title: doc.title, description: doc.summary }, <DocPage doc={doc} />);
});

// The quest board: a project's chapters, then each quest's page at its path
// without `.md`, the way its branch is named.
const boards = new WeakMap<Project, Board>();
function board(name: string): Board | null {
	const project = findProject(name);
	if (!project) return null;
	if (!boards.has(project)) boards.set(project, readBoard(project));
	return boards.get(project)!;
}
app.get("/repos/:repository", (c) => {
	const found = board(c.req.param("repository"));
	if (!found) return c.notFound();
	const { project } = found;
	const show = SHOWN.find(([kind]) => kind === c.req.query("show"))?.[0] ?? null;
	return page(
		c,
		{
			title: `${project.title} quest log`,
			description: `What is available, in progress, and finished in ${project.title}.`,
		},
		<BoardPage board={found} show={show} />,
	);
});
app.get("/repos/:repository/quest/*", (c) => {
	const found = board(c.req.param("repository"));
	const prefix = `/repos/${c.req.param("repository")}/`;
	const doc = found && findQuest(found, decodeURIComponent(c.req.path.slice(prefix.length)));
	if (!found || !doc) return c.notFound();
	const href = `/repos/${found.project.name}`;
	if (doc.path === "quest/README.md") return c.redirect(href);
	const content = found.project.documents.find((d) => d.path === doc.path)!.content;
	const crumbs = questCrumbs(found, doc);
	return page(
		c,
		{
			title: crumbs.at(-1)!.label,
			description: `A quest in ${found.project.title}.`,
			crumbs,
		},
		(user) => <QuestPage board={found} doc={doc} content={content} user={user} path={c.req.path} />,
	);
});
app.get("/repos/:repository/quest", (c) => c.redirect(`/repos/${c.req.param("repository")}`));

app.notFound((c) =>
	page(
		c,
		{ title: "Not found", description: "This page is not on the map." },
		<section class="wrap lost">
			<h1>Uncharted territory</h1>
			<p>
				This page is not on the map. Head back <a href="/">home</a> or read <a href="/docs">the docs</a>.
			</p>
		</section>,
		404,
	),
);

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
	// Return to the page that signed in, if it names a path on this site.
	const { next } = await c.req.parseBody();
	const callbackURL = typeof next === "string" && /^\/(?![/\\])[^\\]*$/.test(next) ? next : "/";
	const response = await createAuth(c.env).api.signInSocial({
		body: { provider: "github", callbackURL },
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
	console.error({ event: "request_failed", path: c.req.path, name: error.name });
	return c.json({ error: "Request failed" }, 500);
});
export default app;
