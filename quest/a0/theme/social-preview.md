# [XS] Upload the social preview image

## Goal

The repository's GitHub social preview is `design/theme/og.png`, so shared links
show the quest-log identity before the 2026-10-14 demo.

Waits on a maintainer. GitHub has no API for the upload: open the repository's
Settings, General, Social preview, and upload `design/theme/og.png`. Check with
`gh api graphql -f query='{repository(owner:"kixelated",name:"quest"){usesCustomOpenGraphImage}}'`;
delete this quest once it returns `true`.

## Plan

- This quest covers only the upload; the description, topics, and homepage
  were set with `gh repo edit` on 2026-10-07.
- As a human-action quest it resurfaces at every triage once ready, and the
  upload takes a minute.
- `og.png` was last re-exported on 2026-10-07 with the new size colours
  (L red), so it is ready to upload. An upload made before then shows the
  old orange L; upload it again.
- If `og.svg` changes, re-export `og.png` as `design/theme.md` describes and
  upload it again.
