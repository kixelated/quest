# [M] Serve skills and the contract from the binary

## Goal

`quest skill <name>` prints a skill's full instructions and `quest guide` prints
the quest contract (today's `quest/AGENTS.md`), both compiled into the binary,
so a repository's installed files never change between versions. This
repository dogfoods it: its own skills become stubs and `quest/AGENTS.md` goes
away.

## Plan

- A stub is a `SKILL.md` with the skill's frontmatter and one line: run
  `quest skill <name>` and follow its output. If `quest` is missing, point at
  the setup guide. Stubs are identical across versions, which is what lets
  upgrades leave repositories alone. `quest skill` can print a stub too, so
  init and this repository share one source.
- The skill texts refer to `quest guide` instead of `quest/AGENTS.md`.
- Ship plan-quests, plan-issues, start-quest, spawn-quests, and move merge,
  spawn-merge, and close in from kixelated/skills so the whole loop comes from
  one version. Their removal from kixelated/skills happens with the MoQ
  migration, where it is consumed.
- Codex reads `.agents/skills`; decide during implementation whether stubs
  carry the `agents/openai.yaml` metadata too.
- The export skill is its own quest and lands in the same mechanism.
