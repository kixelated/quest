# [S] Read only what changed in each history pass

## Goal

A history pass over a project reads only the issues and pull requests that
changed since the last pass, and fetches pull request bodies only where the
board needs them, instead of paging every entity each time.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#182](https://github.com/kixelated/quest/pull/182):

- Each history page now fetches up to 50 pull request bodies, and a full pass
  still pages every entity: about 126 pages on moq-dev/moq.
- Page by update time from the last pass's high-water mark, and read bodies
  only for open drafts, whose `## Decisions needed` section decides whether
  the board shows them as claimed or handed back.
- m1: m0 pilots are small enough that full passes are affordable.
- Dropped (user): caching installation tokens across an inbox load, until
  pilots show slow inboxes.
