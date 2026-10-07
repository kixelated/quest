#!/usr/bin/env bash
# Exercise an installed CLI in fresh repositories without remote writes.
set -euo pipefail

binary=${1:?usage: lifecycle-check.sh /absolute/path/to/quest}
case "$binary" in
    /*) ;;
    *)
        echo 'Expected an absolute path to the installed binary' >&2
        exit 1
        ;;
esac
"$binary" --version
work=$(mktemp -d "${TMPDIR:-/tmp}/quest-lifecycle.XXXXXX")
trap 'rm -rf "$work"' EXIT

assert_file() {
    cmp "$1" "$2" || {
        printf 'User content changed: %s\n' "$2" >&2
        exit 1
    }
}

# Both supported real skill directories, and both instruction-file choices.
for layout in claude agents; do
    repo="$work/$layout"
    mkdir -p "$repo/.$layout/skills/custom"
    git -C "$repo" init --quiet
    instructions=AGENTS.md
    if [[ $layout == agents ]]; then instructions=CLAUDE.md; fi
    printf '# Repository rules\n\nKeep this user rule.\n' >"$repo/$instructions"
    cp "$repo/$instructions" "$work/instructions-$layout"
    if [[ $layout == claude ]]; then
        printf '# Claude rules\n\nKeep these too.\n' >"$repo/CLAUDE.md"
        cp "$repo/CLAUDE.md" "$work/claude-rules"
    fi
    printf '# Custom skill\n\nUser-owned workflow.\n' >"$repo/.$layout/skills/custom/SKILL.md"
    cp "$repo/.$layout/skills/custom/SKILL.md" "$work/custom-$layout"

    "$binary" --root "$repo" init
    "$binary" --root "$repo" init >"$work/reinit"
    [[ ! -s $work/reinit ]] || {
        echo 'Second init changed files' >&2
        exit 1
    }
    for skill in audit complete delete export import iterate merge plan spawn start; do
        "$binary" skill "$skill" --stub >"$work/stub"
        assert_file "$work/stub" "$repo/.claude/skills/quest-$skill/SKILL.md"
        assert_file "$work/stub" "$repo/.agents/skills/quest-$skill/SKILL.md"
    done
    if [[ $layout == agents ]]; then [[ ! -e $repo/AGENTS.md ]]; fi

    mkdir -p "$repo/quest/c0"
    cat >"$repo/quest/README.md" <<'QUEST'
# Lifecycle repository

## Goal

Exercise installation and removal without losing user content.

## Required

- [First chapter](/quest/c0/README.md) - prove the planned lifecycle
QUEST
    cat >"$repo/quest/c0/README.md" <<'QUEST'
# First chapter

## Goal

Prove the planned lifecycle.

## Required

- [Bootstrap](/quest/c0/bootstrap.md) - create the initial artifact
- [Follow-up](/quest/c0/follow-up.md) - build on the artifact
QUEST
    cat >"$repo/quest/c0/bootstrap.md" <<'QUEST'
# [S] Bootstrap

## Goal

Create the initial artifact.
QUEST
    cat >"$repo/quest/c0/follow-up.md" <<'QUEST'
# [S] Follow-up

## Goal

Use the initial artifact.

## Required

- [Bootstrap](/quest/c0/bootstrap.md) - obtain the artifact first
QUEST
    "$binary" --root "$repo" check
    "$binary" --root "$repo" ready >"$work/ready"
    printf 'quest/c0/bootstrap.md\n' >"$work/expected-ready"
    assert_file "$work/expected-ready" "$work/ready"
    "$binary" --root "$repo" ready quest/c0/bootstrap.md >"$work/blockers"
    [[ ! -s $work/blockers ]]
    "$binary" --root "$repo" ready quest/c0/follow-up.md >"$work/blockers"
    grep -F 'quest/c0/bootstrap.md' "$work/blockers"
    cp -R "$repo/quest" "$work/plans-$layout"

    # Uninstall removes its stubs, but keeps edited stubs and extra user files.
    printf '\nUser customization.\n' >>"$repo/.$layout/skills/quest-plan/SKILL.md"
    cp "$repo/.$layout/skills/quest-plan/SKILL.md" "$work/edited-$layout"
    printf 'User notes.\n' >"$repo/.$layout/skills/quest-start/notes.md"
    cp "$repo/.$layout/skills/quest-start/notes.md" "$work/notes-$layout"
    "$binary" --root "$repo" uninstall
    assert_file "$work/instructions-$layout" "$repo/$instructions"
    if [[ $layout == claude ]]; then assert_file "$work/claude-rules" "$repo/CLAUDE.md"; fi
    assert_file "$work/custom-$layout" "$repo/.$layout/skills/custom/SKILL.md"
    assert_file "$work/edited-$layout" "$repo/.$layout/skills/quest-plan/SKILL.md"
    assert_file "$work/notes-$layout" "$repo/.$layout/skills/quest-start/notes.md"
    [[ ! -e $repo/.$layout/skills/quest-start/SKILL.md ]]
    [[ ! -e $repo/.$layout/skills/quest-export ]]
    diff -r "$work/plans-$layout" "$repo/quest"
    "$binary" --root "$repo" check
    "$binary" --root "$repo" uninstall >"$work/reuninstall"
    [[ ! -s $work/reuninstall ]]
done

# A same-named user skill must cause refusal, without losing existing content.
for instructions in AGENTS.md CLAUDE.md; do
    repo="$work/conflict-$instructions"
    mkdir -p "$repo/.claude/skills/quest-start"
    printf '# User instructions\n' >"$repo/$instructions"
    printf '# My quest-start\n\nDo not replace this.\n' >"$repo/.claude/skills/quest-start/SKILL.md"
    cp "$repo/$instructions" "$work/conflict-instructions"
    cp "$repo/.claude/skills/quest-start/SKILL.md" "$work/conflict-skill"
    if "$binary" --root "$repo" init >"$work/conflict-output" 2>&1; then
        echo 'Init overwrote or accepted a same-named user skill' >&2
        exit 1
    fi
    grep -F '.claude/skills/quest-start/SKILL.md is not a Quest stub' "$work/conflict-output"
    "$binary" --root "$repo" uninstall
    assert_file "$work/conflict-instructions" "$repo/$instructions"
    assert_file "$work/conflict-skill" "$repo/.claude/skills/quest-start/SKILL.md"
done

echo 'quest lifecycle: fresh repositories, ownership, and conflict refusal passed'
