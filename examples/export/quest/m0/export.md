# [S] Add a CSV export endpoint

## Goal

The signed-in user can request a CSV containing their own records.

## Plan

Return a header row even when there are no records. Escape commas, quotes, and
newlines correctly. Verify that one user cannot export another user's data.
