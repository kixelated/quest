# [M] Complete Google, passkey and linked-account sign-in

## Goal

People can sign in with GitHub, Google or a passkey and explicitly link login
providers to the same account. Fork ownership, permissions and public credit
stay with one stable, verified contributor identity regardless of the sign-in
method. Claims and issues name that identity's provider and subject. This may
slip past the competition demo.

## Plan

Policies settled on 2026-10-02. The user confirmed planning the remaining login
work, accepted the first recommendations, and selected `/recommended` for the
remaining decisions. Google and passkey authentication are already prepared in
PR #42; account linking and identity migration still need implementation.

- Link providers only through an explicit action by a signed-in account that
  proves ownership of the additional provider. Keep implicit email linking
  disabled: a matching email must not grant another provider access to existing
  forks or permissions.
- Persist one verified OAuth provider and subject as the contributor identity.
  New accounts use their first verified provider. Adding another provider or
  signing in with a passkey keeps that identity, so authentication order cannot
  change fork ownership or attribution.
- Migrate existing accounts using their registered fork identity. Preserve user
  IDs, fork names, existing claims and repository maintainer rights. Accounts
  without forks retain their existing verified provider identity. Report any
  inconsistent stored identities for reconciliation instead of rewriting
  ownership or historical credit.
- Allow explicit linking across different provider emails after both identities
  are proven. Ownership comes from authentication, rather than email equality.
- Reject linking a provider identity already owned by a different account.
  Account merging is outside this quest because it needs a separate policy for
  forks, permissions, sessions and stored credentials.
- Defer OAuth provider unlinking, including the currently exposed direct HTTP
  endpoint. Retain passkey removal and recovery through an existing OAuth login
  or another passkey, without an administrator recovery bypass. Keeping OAuth
  providers attached preserves the canonical identity and recovery path.
- Use the canonical contributor identity consistently for `AUTH_MAINTAINERS`.
  Linking another provider does not qualify an account for operator registration;
  existing repository maintainer rights remain attached to the same user ID.
- Update `cloudflare/LOGINS.md` for linking, identity, recovery and migration.
  Keep live provider registration, deployment and browser verification in the
  parent quest; no separate account guide is needed.

Remaining implementation:

- Add and backfill the account's canonical identity, then share its resolution
  between authenticated HTTP actors and review/merge attribution. Keep intake's
  stored fork identity consistent with that account identity.
- Enable explicit provider-linking controls and their HTTP route only after the
  identity migration is in place. Enforce provider ownership and account-collision
  checks, and close the unsupported OAuth unlink route.
- Extend the existing authentication and coordinator regressions for both
  linking orders, different emails, collisions, existing fork migration,
  passkey sign-in, claim/issue/review credit and operator/maintainer authority.
  Exercise direct HTTP endpoints as well as UI actions.
- Keep setup and recovery documentation accurate, run the repository's pinned
  checks and tests, and review the completed login outcome before merging it.

## Related

- [Cloudflare deployment and end-to-end verification](/quest/m0/cloudflare/README.md)
