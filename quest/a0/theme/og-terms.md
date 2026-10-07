# [XS] Use format terms in the social image

## Goal

`design/theme/og.svg` labels its sample entries with the format's terms
(ready, blocked, `Required`, claimed, in review) instead of the display
aliases (Available, Requires, Ready to turn in), and `design/theme/og.png` is
re-exported from it as `design/theme.md` describes. The maintainer then
uploads the social preview once, with the right terms.

## Plan

Decided 2026-10-07: fix the image before the upload rather than uploading now
and redoing it after the theme's final pass. The labels to change are the
three right-aligned status texts and the "display glossary" comment in
`og.svg`. Update the `og.png` note in
[social preview](/quest/a0/theme/social-preview.md) once it is re-exported.
