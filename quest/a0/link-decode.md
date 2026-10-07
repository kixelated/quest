# [XS] Percent-decode quest link targets

## Goal

The core resolves Markdown link targets the way GitHub does: it
percent-decodes each path segment before resolving it. So
`[x](/quest/a0/x%23y.md)` and `[x](/quest/a0/with%20space.md)` link to
`x#y.md` and `with space.md`, in `Required` and everywhere `quest check`
resolves links. Quests with spaces, `#`, or `%` in their names can then be
linked and blocked on like any other. A target that doesn't decode cleanly
(for example, a stray `%`) is reported as unresolved.

## Plan

Decided on 2026-10-07, after the review of kixelated/quest#85. The user chose
to encode board URLs so that any quest name works
([Board links](/quest/a0/cloudflare/board-links.md)). Without decoding in the
core, such names still can't be linked, so this completes that choice. Tests
cover each of the three characters and a malformed escape.
