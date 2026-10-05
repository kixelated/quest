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
- Ranked first in the theme questline because the image already exists and
  the upload takes a minute; as a human-action quest it stays ready and
  resurfaces at every triage until done.
- If `og.svg` changes, re-export `og.png` as `docs/theme.md` describes and
  upload it again.
