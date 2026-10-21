# [S] Connect the landing page to Kix

## Goal

The home page on `https://kix.quest` explains the maintainer path (decide
from your phone while your runners do the work) and leads into sign-in,
project onboarding, and runner setup. Returning maintainers reach
their decision inbox. The standalone Quest setup remains easy to find.

## Plan

- Preserve the existing shared visual design and map; make the simple prompt
  workflow the product's main entry point rather than adding a dashboard.
- Do not advertise cloud runners, API-key funding, or donations until they
  ship in m1.
- Retain the working setup link. Switch README/getting-started examples to
  kix.quest/setup only once that endpoint serves the actual setup instructions.

## Required

- [Deploy kix.quest](/quest/m0/kix/deploy.md) - the live site and setup link
