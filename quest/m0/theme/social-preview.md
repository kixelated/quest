# [XS] Upload the social preview image

## Goal

The repository's GitHub social preview is `docs/theme/og.png`, so shared links
show the quest-log identity before the 2026-10-14 demo.

Waits on a maintainer. GitHub has no API for the upload: open the repository's
Settings, General, Social preview, and upload `docs/theme/og.png`. Check with
`gh api graphql -f query='{repository(owner:"kixelated",name:"quest"){usesCustomOpenGraphImage}}'`;
delete this quest once it returns `true`.

## Plan

- Decided on 2026-10-05: this quest covers only the upload. The repository
  description, topics, and homepage were set separately with `gh repo edit`
  on 2026-10-07.
- As a human-action quest it resurfaces at every triage once ready, and the
  upload takes a minute.
- `og.png` was re-exported in the "illuminated ledger" identity on
  2026-10-06, so it is ready to upload.
- If `og.svg` changes, re-export `og.png` as `docs/theme.md` describes and
  upload it again.
