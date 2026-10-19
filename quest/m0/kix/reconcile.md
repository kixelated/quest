# [S] Reconcile projects after each webhook

## Goal

A new GitHub issue, PR, or quest change arrives in the decision inbox with its
title and context, ready to act on, without anyone clicking "Refresh from
GitHub". The manual refresh stays as a fallback. Webhooks still never approve
or launch work.

## Plan

Decided 2026-10-18 as a follow-up of the decision inbox (#144), which shows a
webhook's item as a bare pointer ("Issue #N") and offers only a refresh until
someone reads the project from GitHub:

- After a webhook records an observation, reconcile that project in the
  background with the App's installation token. Coalesce bursts so repeated
  or duplicate deliveries for one project trigger one read, not one each.
- Background reads publish observations only. Authority stays per request:
  every action still rechecks the acting maintainer, as decided for the
  inbox, so a background read never grants or caches authority.
- A failed or rate-limited reconcile leaves the item as it is today, with
  the refresh fallback and its reason shown, and a later webhook or refresh
  retries. No retry loops.
- The per-load GitHub call count (about five per project) stays as is until
  it becomes a measured problem; caching authority checks would weaken the
  per-request recheck.
- Test with duplicate deliveries, a burst of deliveries, a failed read, and a
  webhook for a paused or disconnected project.
