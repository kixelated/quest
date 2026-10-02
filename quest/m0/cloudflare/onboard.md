# [M] Onboard an existing GitHub repository

## Goal

A maintainer enters a GitHub repository URL and installs the app's GitHub
App. The app imports the repository into Artifacts and opens a GitHub PR with
the `quest init` result and the `issues/**` warning hooks. Once that PR merges,
sync is on.

## Plan

- Opening a PR (not pushing to main) keeps the maintainer in control.
- Import uses the Artifacts `import` API. `quest init` runs in a Sandbox
  built from this repository's commit.

## Required

- [GitHub sync](/quest/m0/cloudflare/github-sync.md) - the GitHub App and the sync this turns on
