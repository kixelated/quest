// Optional Google sign-in secret, which `wrangler types` cannot declare without
// making every deploy require it. Wrangler dev loads only declared secrets, so
// to try Google locally, temporarily add it to `secrets.required`.
interface Env {
	GOOGLE_CLIENT_SECRET?: string;
}
