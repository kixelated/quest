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

## Settled policy and remaining work

This PR retains the unfinished login quest. Its account-linking and contributor
identity policies are settled, but linking is still disabled at the HTTP boundary
until the remaining implementation is complete.
New Google-only accounts use their verified Google subject. Existing provider
attribution remains in place when a passkey authenticates the same account.

The planned completion uses explicit authenticated linking, with no automatic
email-based linking. Different provider emails are allowed after proving both
identities. A provider already owned by another account cannot be linked; account
merging is outside this work.

Each account will retain one canonical verified OAuth provider and subject for
fork ownership and public contributor credit. New accounts use their first
verified provider; migration preserves existing registered-fork identities and
user IDs. Linking or passkey sign-in will keep that identity. Operator registration
will check the canonical identity against `AUTH_MAINTAINERS`; linking an allowlisted
provider will not independently confer that permission. Repository maintainer
rights remain attached to the same user ID.

OAuth provider unlinking is deferred, including closing the currently exposed
unlink endpoint. Passkey removal and recovery through existing OAuth providers
or another passkey remain available. No administrator recovery bypass is planned.

The remaining implementation must persist and migrate the canonical identity,
share it across intake and review attribution, enforce linking ownership and
collision checks, and then enable the linking controls. Completion requires tests for
both linking orders, different emails, existing forks, passkeys, claims, issues,
reviews and operator/maintainer authority. Live provider configuration and browser
verification remain part of the parent deployment work. The full plan is in the
[login quest](../quest/m0/cloudflare/logins.md).
