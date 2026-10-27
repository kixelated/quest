# [S] Pick repositories after installing the App

## Goal

After installing the App, GitHub returns the maintainer to kix.quest, which
lists the repositories that installation can reach and that the maintainer
maintains, each with its eligibility and an Enable button. Nobody types
`owner/repository` to enroll.

## Plan

Decided 2026-10-27 (user), option C of the onboarding round recorded in
[App sign-in](/quest/m0/kix/app-sign-in.md):

- With sign-in on install, GitHub sends the maintainer to the OAuth callback
  rather than the App's Setup URL, so the picker follows that callback. That
  is why this quest requires App sign-in.
- Each row reuses enrollment's existing checks (live authority, public, OSI
  license, Quest tree) and states why an ineligible repository cannot be
  enabled. A repository without Quest files offers the
  [setup PR](/quest/m0/kix/setup-pr.md) once that lands; until then it links
  `/setup`.
- Keep `/projects/select` for an already-enrolled repository's pause and
  disconnect controls.

## Required

- [App sign-in](/quest/m0/kix/app-sign-in.md) - installing the App also signs the maintainer in, which this picker follows
