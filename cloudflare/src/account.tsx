import type { Hono } from "hono";
import { createAuth, requireActor } from "./auth";
export function accountRoutes(app: Hono<{ Bindings: Env }>) {
	app.get("/account", async (c) => {
		const actor = await requireActor(c.env, c.req.raw.headers);
		const keys = await createAuth(c.env).api.listPasskeys({ headers: c.req.raw.headers });
		const accounts = await c.env.DB.prepare(
			"SELECT providerId,accountId FROM account WHERE userId=? ORDER BY providerId",
		)
			.bind(actor.userId)
			.all<{ providerId: string; accountId: string }>();
		c.header("Cache-Control", "no-store");
		return c.html(
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>Quest account</title>
					<script src="/auth.js" defer></script>
				</head>
				<body>
					<main>
						<h1>Account</h1>
						<p>{actor.name}</p>
						<p>
							Verified identity: {actor.provider}:{actor.identity}
						</p>
						<h2>Linked providers</h2>
						<ul>
							{accounts.results.map((account) => (
								<li>
									{account.providerId}:{account.accountId}
								</li>
							))}
						</ul>
						<p>Additional provider linking is not available yet.</p>
						<h2>Passkeys</h2>
						<p>Sign in with GitHub or Google first, then add a passkey for this account.</p>
						<button type="button" data-auth-action="passkey-add">
							Add a passkey
						</button>
						<ul>
							{keys.map((key) => (
								<li>
									{key.name || "Passkey"}{" "}
									<button type="button" data-auth-action="passkey-delete" data-id={key.id}>
										Remove
									</button>
								</li>
							))}
						</ul>
						<p id="auth-status" role="status" aria-live="polite"></p>
						<noscript>Passkey and account linking controls require JavaScript.</noscript>
						<a href="/">Home</a>
					</main>
				</body>
			</html>,
		);
	});
}
