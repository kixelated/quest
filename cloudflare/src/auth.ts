import { passkey } from "@better-auth/passkey";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { IntakeError, type Actor } from "./intake/registry";

import { claimDisplayName } from "./intake/claim";

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
		name: claimDisplayName(session.user.name) || `${account.providerId}:${account.accountId}`,
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
		// Secure linking policy is prepared separately from sign-in.
		account: { accountLinking: { disableImplicitLinking: true } },
		plugins: [
			passkey({
				rpID: new URL(env.AUTH_URL).hostname,
				rpName: "Quest",
				origin: new URL(env.AUTH_URL).origin,
				authenticatorSelection: { residentKey: "required", userVerification: "required" },
				registration: {
					requireSession: true,
					afterVerification: async ({ verification }) => {
						if (!verification.registrationInfo?.userVerified)
							throw new APIError("FORBIDDEN", { message: "Passkey user verification required" });
					},
				},
				authentication: {
					afterVerification: async ({ verification }) => {
						if (!verification.authenticationInfo.userVerified)
							throw new APIError("FORBIDDEN", { message: "Passkey user verification required" });
					},
				},
			}),
		],
		socialProviders: {
			...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
				: {}),
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
			},
		},
	});
}
