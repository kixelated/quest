Keep the core independent of a particular repository, agent, or issue tracker.
Prefer simple, maintainable changes and ask about consequential product choices.

- Read `CONTRIBUTING.md` before making changes or preparing a PR.
- Read `PROMPTING.md` before changing instructions or skills, or delegating work.
- Keep shared workflow instructions in `assets/AGENTS.md`.
- Keep skills in `assets/skills/` and explain only their particular workflow.

Do not edit these files without permission.

## Development

- Run `quest guide` and read it completely before planning or executing quests.
- Keep README examples consistent with the CLI's actual `--help` output.
  In this checkout, `quest` means `cargo run --quiet --locked --`.
- Use an isolated worktree under `.worktrees/`. Preserve existing changes.
- Use the Nix shell so local tooling matches CI: `nix develop`
- Run `just check` and `just test` before handing off changes; `just fix` applies
  formatting. Missing tools are failures, not checks to silently skip.
- Fix root causes. Do not mask fixable failures with retries, sleeps, or timeouts.
- Prefer simplification and refactoring over compatibility layers for unpublished
  interfaces. Keep changes focused on the requested outcome.
- Reproduce bugs and add a regression test when practical. Wire tests into CI.
- Ask about consequential scope or API choices, with options and a recommendation.
- Stop and report when progress stalls. Leave follow-up work as scoped quests.
- Do not edit instructions or skills unless the user asks for that work.
- Starting or spawning quests stops at PR creation. It merges only when the user
  picks /merge, and only after repository checks and reviews pass.
- End every GitHub post with `(written by <model>)`, naming the running model.
  Do not comment on repositories outside kixelated/moq-dev without approval.
