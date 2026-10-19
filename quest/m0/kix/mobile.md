# [M] Install kix.quest as a phone app with push notifications

## Goal

A maintainer installs kix.quest as a progressive web app on their phone or
desktop, enables notifications, and receives a Web Push notification whenever
something needs a decision. Tapping it opens the app on that decision. This
works on Android, desktop browsers, and iOS/iPadOS 16.4+ once the app is added
to the home screen.

## Plan

Decided 2026-10-15 in the decisions-not-implementations interview:

- An installable PWA with Web Push is the m0 mobile path. A native app
  follows in [the native mobile app quest](/quest/m1/mobile-app.md).
- Only decisions push: an agent question, a new issue or PR decision item, a
  stopped or account-limited job, or a PR ready for review. Progress
  summaries, runner presence changes, and successful completions without a
  pending action never push. The in-app
  inbox still records everything.
- Coalesce per decision item (for example with the notification `tag`), so
  repeated updates and duplicate webhooks replace a notification instead of
  stacking new ones.
- Notifications open the prompt; they have no answer buttons. iOS Web Push
  does not support notification actions, and a single answer path keeps
  stale- and duplicate-answer protection in one place. Quick replies wait for
  the native app.
- Store push subscriptions per user and device in D1. Delete them on
  sign-out and when the push service reports them gone (404/410). Ask for
  permission only after a user gesture, never on page load.
- Keep the VAPID private key in Worker secrets. Verify that Web Push payload
  encryption and VAPID signing work in the Workers runtime with WebCrypto
  before choosing a library. Keep payloads minimal (project and decision
  title), since the full context loads in the app.
- Show an unread decision count in the nav and, where the Badging API is
  supported, on the installed app icon. Decided 2026-10-18 as a follow-up of
  the decision inbox (#144), folded here rather than its own quest.
- Make the installed app phone-first: the inbox, prompts, and activity cards
  fit a narrow viewport and work with touch and keyboard.
- Sources:
  [Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
  [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
  and [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291).

## Required

- [Decision inbox](/quest/m0/kix/prompts.md) - the decision items that notifications open
