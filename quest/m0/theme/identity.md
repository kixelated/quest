# [S] Create the quest log identity

## Goal

Quest has an original mark (a gold `!`, for example on a scroll or shield),
a dark palette, a heading and body type pairing, and an OG/social image.
All of it is committed as hand-written SVG and CSS under `assets/` or `docs/`.
`docs/theme.md` records the display glossary, status markers, difficulty colours,
and palette, so the board, landing page, CLI, and copy draw from one place.

## Plan

- Code-authored SVG, not commissioned or AI-generated art. It is fast,
  reviewable in a PR, crisp at every size, and clearly original.
- Use only open-licensed fonts (for example a Google Fonts serif for
  headings). Use no Blizzard assets or lookalike trademarks.
- The palette is dark only (slate panels, gold borders). The difficulty colours
  must stay distinguishable on it and keep a text label, so colour is never the
  only signal.
- Copy the glossary from [the questline Plan](/quest/m0/theme/README.md) into
  `docs/theme.md` and treat the doc as canonical afterwards.
- Export a PNG of the OG image for GitHub's social preview, which a maintainer
  uploads by hand in repository settings.
