# [M] Review every change with a trusted runner's agent

## Goal

Each new head of a change gets a review job. A trusted runner's agent reviews
the diff against the quest's Goal and Plan, and posts an approve or
request-changes verdict with findings as a git note. The change shows the
verdict, and only trusted verdicts count toward "ready to merge".

## Plan

- Decided 2026-10-07: no automatic iteration. Findings wait for a maintainer
  or the contributor to act.
- Reviews spend the trusted runner owner's agent login, or the Sandbox's
  stored key when it is the fallback.

## Required

- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - the job loop
- [Changes](/quest/a0/cloudflare/changes.md) - notes and the change view
