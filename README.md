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

Shared instructions use `AGENTS.md`. Claude Code supports reading it directly
from v2.1.277, subject to its project-instruction settings and session support.
Existing project or ancestor `CLAUDE.md` files can take precedence. See
[Claude's AGENTS.md documentation](https://code.claude.com/docs/en/memory#agentsmd)
when adopting Quest in an existing setup.

For manual adoption in another repository, copy `quest/AGENTS.md` and the four
skill directories. Put skills in the agent's project skill directory, add a brief
pointer to `quest/AGENTS.md` in the existing root instructions, and create
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
and individual quests following [the format](quest/AGENTS.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and contribution workflow.

## Development

The Nix shell and just recipes are shared by local development and CI:

```sh
nix develop --command just check
nix develop --command just test
nix build
```

The development setup is trimmed from MoQ and includes pinned tools, optional
direnv loading, editor settings, dependency updates, and Linux/macOS checks.

## Origin and license

Extracted from `moq-dev/moq` at commit
`2bb3e6e3f3f357be7bb5f7a8e7feb4348cfdefe4`: `rs/quest`, the four quest skills,
and the quest workflow contract. The Nix/just/CI setup and direnv hook are adapted
from the same repository. MoQ's application backlog, media dependencies, and
deployment configuration are not included. Original copyright notices are retained.

Licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
