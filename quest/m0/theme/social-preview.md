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
  description, topics, and homepage stay in
  [Copy](/quest/m0/theme/copy.md), since an agent can set them with
  `gh repo edit` once their wording is approved.
- As a human-action quest it resurfaces at every triage once ready, and the
  upload takes a minute.
- Waits for [Site](/quest/m0/theme/site.md), which re-exports `og.png` in
  the refreshed identity (2026-10-06). Uploading the old image first would
  only be redone.
- If `og.svg` changes, re-export `og.png` as `docs/theme.md` describes and
  upload it again.

## Required

- [Site](/quest/m0/theme/site.md) - re-exports `og.png` in the new identity
