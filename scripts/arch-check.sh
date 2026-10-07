#!/usr/bin/env bash
# Check that a quest binary is built for a release target's architecture.
# Under Rosetta, an x86_64 binary also runs on Apple silicon, so running it
# proves nothing about which archive was packed or installed.
set -euo pipefail

binary=${1:?usage: arch-check.sh binary target-triple}
target=${2:?usage: arch-check.sh binary target-triple}
case "$target" in
    aarch64-apple-darwin) format=Mach-O arch='arm64' ;;
    x86_64-apple-darwin) format=Mach-O arch='x86_64' ;;
    aarch64-unknown-linux-gnu) format=ELF arch='aarch64' ;;
    x86_64-unknown-linux-gnu) format=ELF arch='x86-64' ;;
    *)
        printf 'Unknown target: %s\n' "$target" >&2
        exit 1
        ;;
esac
kind=$(file -b "$binary")
if [[ $kind != "$format "* || $kind != *"$arch"* ]]; then
    printf '%s is not built for %s: %s\n' "$binary" "$target" "$kind" >&2
    exit 1
fi
