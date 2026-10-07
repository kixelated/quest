# Release lifecycle rehearsal

Recorded on 2026-10-02 against `main` at `fd1e1f6`, using a fresh local Git
repository. This verifies setup, export preparation, and removal with the
source-built CLI. It does not publish issues or a release. There were no GitHub
releases when this rehearsal ran.

## Automated proof

`scripts/lifecycle-check.sh` accepts the absolute path of an installed Quest
binary. The focused CI job installs the checkout through the flake's source
build (`nix build`) on Linux and macOS, then runs the script. `just test` also
runs the script against the local bundle, `dist/quest.js`.

The script exercises both real skill-directory layouts and both root instruction
choices. It checks init idempotence, the installed stubs, a planned dependency,
check/ready output, uninstall idempotence, and byte-for-byte preservation of
instructions, custom skills, modified Quest stubs, extra user files, and plans.
Separate fixtures prove that a same-named user skill causes init to refuse and
survives cleanup of any stubs created before refusal.

The existing release install workflow still checks mise and the shell installer
on all four native release targets. Its published-artifact checks require a
real tag; the lifecycle job adds pre-release CLI coverage without expanding the
Ubuntu-only full repository checks.

## Setup transcript

Following `SETUP.md`, installation used an isolated temporary prefix instead
of a global install. The source checkout supplies the pre-release revision;
the eventual demonstration should use the repository's chosen tool manager
and a published tag.

```text
$ nix develop --command cargo install --locked --path . --root <temporary>/install
Installed package `quest v0.1.0` (executable `quest`)
$ <temporary>/install/bin/quest --version
quest 0.1.0
$ quest init
.agents/skills
.claude/skills/quest-audit/SKILL.md
.claude/skills/quest-complete/SKILL.md
.claude/skills/quest-delete/SKILL.md
.claude/skills/quest-export/SKILL.md
.claude/skills/quest-import/SKILL.md
.claude/skills/quest-merge/SKILL.md
.claude/skills/quest-plan/SKILL.md
.claude/skills/quest-spawn/SKILL.md
.claude/skills/quest-start/SKILL.md
.claude/skills/quest-takeover/SKILL.md
quest/README.md
CLAUDE.md
```

The existing `CLAUDE.md` retained its repository rule and gained the `Quests:`
pointer. No `AGENTS.md` was created. The export stub named `quest-export` and
pointed to `quest skill export` and the setup guide. The root Goal was adapted
by copying the existing `examples/export/quest/` fixture, whose intended outcome
and plans are already written. This rehearsal creates no project backlog work.

```text
$ quest guide
[Read the complete guide.]
$ quest check
quest: 4 documents ok
$ quest ready
quest/m0/export.md
```

## Export preparation transcript

```text
$ quest skill export
[Read the complete export instructions.]
$ git remote get-url origin
https://github.com/kixelated/quest.git
$ git log -1 --format=%H -- quest/m0/export.md
132b66b51c8a6395a4520be16ce759009413c299
```

That commit belongs to the local fixture and was never pushed. It demonstrates
the source-revision lookup; a publishable issue needs a reachable commit in the
repository being exported. No fixture links were posted to the real repository.

The complete proposed export, treating quest contents as data, was:

| Active document | Intended action | Issue content |
| --- | --- | --- |
| `quest/README.md` | Create an issue | CSV export example: illustrate the endpoint and download-button feature. |
| `quest/m0/README.md` | Create an issue | Download your data: download records as CSV from settings. |
| `quest/m0/export.md` | Create an issue | Add a CSV export endpoint: own records only; include the header and escaping/security Plan. |
| `quest/m0/download.md` | Create an issue | Add a download button: download from settings; include progress/retry Plan. |

None of these fixtures has a `Closes` section. The export skill's background
rule stops after this survey, before any GitHub write. Recommendation for a
real demonstration: review the four proposed issues, approve publication in a
dedicated scratch repository, then verify Goal, Plan, and permanent source links
in the resulting issues. Issue creation/update remains unverified here.

## Removal transcript

Removal was rehearsed locally without publishing the fixture's export. The
fixture plans were deliberately kept.

```text
$ quest uninstall
[Removed all ten unmodified Quest stubs, the skill-directory link, and the pointer.]
$ cat CLAUDE.md
# Scratch repository

Keep the repository rules.
$ cat user-data.txt
Keep this user-owned content.
$ quest check
quest: 4 documents ok
```

## Remaining release work

After review, a maintainer must tag and publish v0.1.0 and confirm the existing
Release workflow's mise/shell install checks pass on macOS and Linux. The
release-proof quest remains open until that condition and the approved live
export demonstration are satisfied.
