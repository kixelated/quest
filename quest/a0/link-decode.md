# [XS] Percent-decode quest link targets

## Goal

The core resolves Markdown link targets the way GitHub does: after stripping
a `#fragment`, it percent-decodes the path, then normalizes it and checks that
it stays inside the repository. So `[x](/quest/a0/x%23y.md)` and
`[x](/quest/a0/with%20space.md)` link to `x#y.md` and `with space.md`. This
applies in `resolve` and `rooted`, so `quest check`, readiness, and the board
agree for every link (Required, Closes, Related, and prose). Names with `#` or
`%` can then be linked and required (as `%23` and `%25`), and spaces work as
`%20` as well as inside `<...>`. A target that doesn't decode cleanly (for
example, a stray `%`) fails with `link does not resolve`, as it would on
GitHub, and `rooted` returns `null` for it.

## Plan

Decided on 2026-10-07, after the review of kixelated/quest#85. Board URLs are
encoded so that any quest name works. Without decoding in the core, such
names still can't be linked, so this completes that choice.

GitHub decodes the whole path, so `%2F` acts as a separator rather than part
of a name. A raw `%` (`[x](/quest/a0/100%.md)`) resolves today and stops
resolving, matching GitHub's 400 for a malformed escape.

Tests cover `%20`, `%23`, `%25`, a malformed escape, a fragment after an
encoded name (`x%23y.md#sec`), and an encoded `..` (`%2E%2E`) that must not
escape the repository.
