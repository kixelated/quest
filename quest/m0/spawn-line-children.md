# [S] Spawning skips finished line children and isolates agent scratch

## Goal

`/quest-spawn` never offers a quest that is already finished on its
questline's open branch, and the agents it spawns never share scratch files.

## Plan

Seen in moq-dev/moq on 2026-10-06, spawning 32 quests at once:

- `quest ready` reads only the base branch. A questline that lands children
  into its own open branch (moq-dev/moq#4519, #4653) deletes each finished
  child there, but the child stays ready on the base until the line merges.
  Four of the 32 offered quests were already done, and one agent was spawned
  on one before it noticed.
- Spawned agents wrote logs and PR bodies to the parent session's scratchpad
  under common names, so runs overwrote each other's `check.log` and two PRs
  went up with each other's descriptions.

Open for the implementer: whether `ready` itself consults remote line
branches (it is offline and git-only today) or the spawn skill checks them,
and how the spawn prompt keeps scratch files inside each agent's worktree.
Prefer the shape that keeps the core independent of a forge.
