# Google and passkeys

GitHub remains available. Google is optional: set `GOOGLE_CLIENT_ID` in
`wrangler.jsonc` and `GOOGLE_CLIENT_SECRET` in the local `.dev.vars` file or
with `npm exec -- wrangler secret put GOOGLE_CLIENT_SECRET` from `cloudflare/`.
Register a Google OAuth web client with an exact redirect URI:
`http://localhost:8787/api/auth/callback/google` locally, or
`https://YOUR_PUBLIC_ORIGIN/api/auth/callback/google` in production.
Use separate local and production OAuth clients. Without both settings, Google
is absent from the login choices and its form route reports unavailability.
No credentials are embedded in the browser bundle.

Apply D1 migrations before deploying, as described in [the Worker setup](README.md).
The passkey migration adds a credential table with public keys, counters and
account ownership; private keys stay with the authenticator.

## Passkeys

Sign in with an OAuth provider, open **Account and passkeys**, and choose
**Add a passkey**. Enrollment requires a signed-in, fresh session and authenticator
user verification. A device PIN, biometric check or equivalent verification is
also required during sign-in. The account page lists your keys and allows you to
remove a key. Keep another passkey or access to your linked OAuth account for
recovery; this app does not provide an administrator recovery bypass.

Passkeys require JavaScript and a supported browser/authenticator. Browser
cancellation and unavailable authenticators appear beside the account/login
controls. Better Auth's browser client is bundled locally during the ordinary
Worker build; no external script service is required.

The relying-party ID is the hostname of `AUTH_URL`, and the allowed origin is
its exact origin. Use HTTPS for production; localhost is supported for local
development. Changing the hostname creates a different relying party: existing
passkeys cannot authenticate to the new hostname. Enroll a new key there through
OAuth. All production instances serving one account database must agree on
`AUTH_URL` and `AUTH_SECRET`.

## Verification

Worker tests perform mocked Google and GitHub OAuth callbacks and actual
P-256 WebAuthn registration/authentication against local D1. They cover signature,
origin, challenge replay, user verification, enrollment session and key ownership.
Provider app registration and a real browser/platform authenticator still need
verification against the intended deployment; no live deployment was performed.

References: [Google OAuth](https://better-auth.com/docs/authentication/google),
[passkeys](https://better-auth.com/docs/plugins/passkey), and
[account linking](https://better-auth.com/docs/concepts/users-accounts).

## Pending product choices

This draft retains the unfinished login quest. Account linking is disabled at
the HTTP boundary while its policy and contributor attribution are decided.
New Google-only accounts use their verified Google subject. Existing provider
attribution remains in place when a passkey authenticates the same account.

The recommended completion is explicit authenticated linking plus a stable,
verified contributor identity. Persist a canonical provider/identity on the
account, preserving existing registered-fork ownership during migration. Linking
or passkey sign-in would then keep that identity. Enable the linking controls
only after round-trip tests cover both linking orders, existing forks, claims,
issues and maintainer authority.

Automatic email linking would additionally require an explicit product choice
to let another provider with the same verified email enter an existing account,
including its maintainer permissions. Sign-in-method attribution instead would
require server-owned session provenance, a defined passkey identity and changes
to fork ownership; that is intentionally not implemented in this preparation.
