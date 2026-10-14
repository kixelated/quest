# [S] Make kix.quest the primary domain

## Goal

The site, authentication callbacks, bot links, and public setup URL use
`https://kix.quest`. Requests to `https://kixel.quest` redirect to the
corresponding canonical page. Existing users retain a usable sign-in path.

## Plan

- The user owns both domains and chose kix.quest on 2026-10-13.
- Keep Workers hosting. Update routing, auth origin configuration, generated
  links, deployment documentation, and affected examples together.
- Preserve paths and appropriate query parameters through redirects without
  introducing an open redirect or weakening authentication origin checks.
- Retire the unused Artifacts binding and repository-coordinator scaffold
  with valid configuration/migrations; preserve existing auth data.
- Coordinate the GitHub App's callback and webhook URLs with operator setup.
  Verify the real redirect and sign-in flow after deployment.
