import { betterAuth } from "better-auth";

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
