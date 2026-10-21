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

# The shared lifecycle is also run directly by native Windows CI.
bun "$(dirname -- "${BASH_SOURCE[0]}")/lifecycle-check.mjs" "$binary"

# A reader that closes stdout early, like `quest unblocked | head -1`, ends the
# command quietly. The writer waits on a FIFO until the reader has closed, so
# every write fails with EPIPE rather than racing into the pipe buffer.
mkfifo "$work/reader-closed"
for command in guide skill; do
    status=0
    { read -r <"$work/reader-closed" && "$binary" "$command" 2>"$work/epipe"; } |
        { exec <&- && echo >"$work/reader-closed"; } || status=$?
    if ((status != 0)) || [[ -s $work/epipe ]]; then
        printf 'quest %s exited %d when stdout closed early; stderr:\n' "$command" "$status" >&2
        cat "$work/epipe" >&2
        exit 1
    fi
done

echo 'quest lifecycle: fresh repositories, ownership, conflict refusal, and early-closed stdout passed'
