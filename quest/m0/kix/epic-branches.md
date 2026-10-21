# [S] Start epics on their README branch

## Goal

kix starts, claims, and links an epic on the same branch the CLI uses:
`quest/<path>/README`, its README's path without `.md`. An epic with claimed
children starts like any other quest.

## Plan

Decided 2026-10-21 as a follow-up of
[kixelated/quest#169](https://github.com/kixelated/quest/pull/169), which made
an epic's branch its README's path without `.md` (user decision on that PR):

- kix still uses the directory form. The start job in
  `cloudflare/src/jobs/routes.ts` strips `/README.md`, `associatedQuest` in
  `cloudflare/src/github/state.ts` maps branches back to quests, and
  `questHref` in `cloudflare/src/board/model.ts` builds board links. Git
  cannot create `quest/m0/foo` while any `quest/m0/foo/<child>` branch exists,
  so kix cannot start an epic once a child is claimed.
- Use the CLI's rule (`questBranch` in `src/cli/claims.ts`) rather than a
  second copy; if the Worker cannot import it, share the mapping from the core.
- kix has no production data, so stored directory-form branches need no
  migration.
- Test starting an epic whose child is claimed, mapping `quest/<path>/README`
  back to the epic, and a bare directory branch matching nothing.
