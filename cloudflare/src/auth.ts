import { betterAuth } from "better-auth";
import { IntakeError, type Actor } from "./intake/registry";

export async function requireActor(env: Env, headers: Headers): Promise<Actor> {
	const session = await createAuth(env).api.getSession({ headers });
	if (!session) throw new IntakeError(401, "Sign in required");
	// Provider account IDs come from the verified OAuth callback, never a form
	// field, event author, display name, or fork commit.
	const account = await env.DB.prepare(
		"SELECT providerId, accountId FROM account WHERE userId = ? ORDER BY providerId, accountId LIMIT 1",
	)
		.bind(session.user.id)
		.first<{ providerId: string; accountId: string }>();
	if (!account) throw new IntakeError(403, "Linked provider required");
	return {
		userId: session.user.id,
		provider: account.providerId,
		identity: account.accountId,
		name:
			session.user.name.replace(/[<>\r\n\x00-\x1f]/g, " ").trim() || `${account.providerId}:${account.accountId}`,
		email: session.user.email,
	};
}

// Construct per request: D1 bindings cannot be shared across request contexts.
// New providers/plugins belong here; routes use the same auth API.
export function createAuth(env: Env) {
	return betterAuth({
		database: env.DB,
		baseURL: env.AUTH_URL,
		secret: env.AUTH_SECRET,
		trustedOrigins: [new URL(env.AUTH_URL).origin],
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
			},
		},
	});
}
