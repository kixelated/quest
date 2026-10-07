# [XS] Encode board links and pin them to the snapshot commit

## Goal

Board and map links work for any quest file name. `questHref` and `blobHref`
(`cloudflare/src/board/model.ts`) percent-encode each path segment, so names
containing `#`, `?`, or `%` reach the right page. A `#fragment` passed to
`blobHref` stays a fragment. The board's GitHub links ("View the Markdown" and
links inside rendered Markdown) point at the snapshot commit the board was
built from, matching the map's "Charted from" link. They never 404 for a quest
finished after the snapshot.

## Plan

Decided on 2026-10-07, from the review of kixelated/quest#84:

- Encode segments rather than having `quest check` reject unusual names. The
  user chose this; any name the filesystem allows works on the board.
- Link to the snapshot commit rather than `main`. Revisit when
  [the board reads live projects](/quest/a0/cloudflare/board.md).
- Tests cover a name with `#`, `?`, and `%`, a fragment link, and the commit in
  GitHub links.
