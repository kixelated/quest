# [S] Add Google and passkey logins

## Goal

People can sign in with Google or a passkey as well as GitHub, while repository
permissions continue to come from verified GitHub identity and installation access.

## Plan

Preserve reusable work from draft PR #42 after checking its current base.
Additional sign-in methods do not gate the GitHub-first release and do not
grant repository authority on their own.

## Required

- [GitHub App](/quest/m0/kix/github.md) - existing authentication and repository authority
