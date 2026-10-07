# [L] Build the quest board

## Goal

Anyone can browse a project's quest tree and read its quests rendered. They
see what is ready, blocked (and by what), or claimed (and by whom), plus open
changes and issues. A signed-in contributor can start funding a ready quest
from its page. A maintainer can release claims and promote issues.

## Plan

- Readiness comes from the shared TypeScript core, run over the tree read from Artifacts.
- This is the main surface for the demo, so ease of use counts for 25% of the
  judging.
- Build it themed from the start, not restyled later (decided 2026-10-05 in
  [the theme questline](/quest/m0/theme/README.md)). It looks like a dark
  in-game quest log, and every status uses the glossary in `docs/theme.md`:
  a yellow `!` for ready, a grey `!` with "Requires" for blocked, "Accepted by"
  for claimed, a yellow `?` for an open change, difficulty colours for sizes,
  and Objectives and Rewards for `Goal` and `Closes`.

- Readability first (decided 2026-10-06): a human should see long-term
  progress at a glance. Open on each milestone (chapter) with a progress bar,
  then its questlines and quests with their statuses.
- Progress counts finished work from git, since merged quests are deleted:
  quest files removed by merges under each milestone, weighted by size, and
  cached when sync runs. Show "N of M done" and a recently completed list.
- Whether the board also opens on the home page's quest map is undecided.
  Build the list first, then mock [the home page's map](/quest/m0/theme/map.md) as an overview and ask the user
  with screenshots before shipping it.
- Use the shared layout from [Site](/quest/m0/theme/site.md). If the board
  lands first, the site quest moves it onto the shell.
- Show token spend as gold coins and the fund action as "Offer gold", per
  the glossary in `docs/theme.md`.

## Required

- [Port to TypeScript](/quest/m0/cloudflare/typescript.md) - check and ready in the Worker
