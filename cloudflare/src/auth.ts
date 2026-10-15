import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";

export type Provider = "github" | "google";

// Sign-in providers in display order. GitHub is always configured; Google only
// when both of its credentials are set.
export function providers(env: Env): Provider[] {
	return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ["github", "google"] : ["github"];
}

export const providerNames: Record<Provider, string> = { github: "GitHub", google: "Google" };

// Better Auth's passkey plugin verifies signatures but not user verification;
// require a PIN, biometric, or equivalent check on every ceremony.
function requireUserVerification(verified: boolean | undefined) {
	if (!verified) throw new APIError("FORBIDDEN", { message: "Passkey user verification required" });
}

// Construct per request: D1 bindings cannot be shared across request contexts.
// New providers/plugins belong here; routes use the same auth API.
//
// Every sign-in method reaches the same local user, but repository authority
// comes only from that user's linked GitHub account (see src/github/service.ts).
export function createAuth(env: Env) {
	const url = new URL(env.AUTH_URL);
	return betterAuth({
		database: env.DB,
		baseURL: env.AUTH_URL,
		secret: env.AUTH_SECRET,
		trustedOrigins: [url.origin],
		// Providers join an account only through an explicit link by its signed-in
		// owner, which proves both identities; a matching email never links them.
		account: { accountLinking: { disableImplicitLinking: true, allowDifferentEmails: true } },
		// Unlinking is deferred: it could strand an account without its GitHub authority.
		disabledPaths: ["/unlink-account"],
		databaseHooks: {
			account: {
				create: {
					// One account per provider, so the linked GitHub identity is unambiguous.
					// Returning false makes Better Auth report the link as failed.
					async before(account) {
						const existing = await env.DB.prepare("SELECT 1 FROM account WHERE userId=? AND providerId=?")
							.bind(account.userId, account.providerId)
							.first();
						return existing ? false : undefined;
					},
				},
			},
		},
		plugins: [
			passkey({
				rpID: url.hostname,
				rpName: "Quest",
				origin: url.origin,
				// Discoverable keys sign in without a username. Enrollment requires a
				// fresh session (the plugin default).
				authenticatorSelection: { residentKey: "required", userVerification: "required" },
				registration: {
					afterVerification: async ({ verification }) =>
						requireUserVerification(verification.registrationInfo?.userVerified),
				},
				authentication: {
					afterVerification: async ({ verification }) =>
						requireUserVerification(verification.authenticationInfo.userVerified),
				},
			}),
		],
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
			},
			...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
				: {}),
		},
	});
}
