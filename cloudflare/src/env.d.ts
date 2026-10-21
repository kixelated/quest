// Optional secrets, which `wrangler types` cannot declare without making every
// deploy require them. Wrangler dev loads only declared secrets, so to try one
// locally, temporarily add it to `secrets.required`.
interface Env {
	// Google sign-in, offered only with GOOGLE_CLIENT_ID.
	GOOGLE_CLIENT_SECRET?: string;
	// The Web Push VAPID private key; notifications are offered only with VAPID_PUBLIC_KEY.
	VAPID_PRIVATE_KEY?: string;
}
