# Quest

Plans that live with your code.

Quest keeps work in Markdown files reviewed alongside its implementation.
Quests describe independently deliverable outcomes; ordered questlines organize
them, and explicit dependencies show what can start next. Git preserves completed
plans after they are removed from the active tree.

This is the standalone extraction of the workflow used in
[MoQ](https://github.com/moq-dev/moq). The validator, readiness commands, and four
agent skills work today. Automatic setup, issue migration, managed updates, and
public binary releases are being scoped in [planning notes](docs/planning.md).

## Install from this checkout

Requires Rust 1.91 or newer:

```sh
cargo install --locked --path .
quest --help
quest --root /path/to/repository check
quest --root /path/to/repository ready
quest --root /path/to/repository ready quest/m0/example.md
```

`check` reports invalid headings, broken links, missing index entries, and
dependency cycles. A nonzero exit means validation failed or the command could
not run.

`ready` lists unblocked quests in priority order. With a quest path, it prints
that quest's blockers; no output means ready. Both ready and blocked results
exit zero. A command error exits nonzero. Readiness reads local plans only, so
check branches and PRs before claiming work. Run `check` before relying on a tree
that has not been validated.

## Agent workflow

This checkout includes `plan-quests`, `plan-issues`, `start-quest`, and
`spawn-quests`. Claude Code discovers them in `.claude/skills/`; Codex discovers
the same files through `.agents/skills/`. Invoke `/plan-quests` in Claude Code or
`$plan-quests` in Codex to scope work interactively.

For manual adoption in another repository, copy `quest/CLAUDE.md` and the four
skill directories. Put skills in the agent's project skill directory, add a brief
pointer to `quest/CLAUDE.md` in the existing root instructions, and create
`quest/README.md` using the format below. Preserve existing instructions and
adapt contribution checks to that repository. Automated installation, upgrades,
and removal are not implemented yet.

```markdown
# Quests

## Goal

The outcomes this repository is working toward.

## Quests
```

The permanent root may be empty. Once work is scoped, add milestone questlines
and individual quests following [the format](quest/CLAUDE.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and contribution workflow.

## Origin and license

Extracted from `moq-dev/moq` at commit
`2bb3e6e3f3f357be7bb5f7a8e7feb4348cfdefe4`: `rs/quest`, the four quest skills,
and the quest workflow contract. MoQ's application backlog and environment hooks
are not part of this standalone tool. Original copyright notices are retained.

Licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
