#!/usr/bin/env bash
# Offline regressions for tag selection, native targets and fresh installations.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/quest-install-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/tmp"
export RUNNER_TEMP="$work/tmp"
export INSTALL_TEST_LOG="$work/log"
export PATH="$work/bin:$PATH"
export INSTALL_TEST_OS=Linux INSTALL_TEST_ARCH=x86_64
export INSTALL_TEST_VERSION='quest 0.1.0'

cat >"$work/bin/uname" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  -s) echo "$INSTALL_TEST_OS" ;;
  -m) echo "$INSTALL_TEST_ARCH" ;;
  *) exit 1 ;;
esac
MOCK
cat >"$work/bin/mise" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  use)
    [[ $2 == --pin && $3 == github:kixelated/quest@v0.1.0 ]]
    [[ ! -e $MISE_DATA_DIR && ! -e $MISE_CACHE_DIR && ! -e $MISE_CONFIG_DIR ]]
    [[ $PWD == "$RUNNER_TEMP"/quest-install.*/project ]]
    printf '%s\n' "mise $3" >> "$INSTALL_TEST_LOG"
    if [[ ${INSTALL_TEST_MISSING:-0} == 1 ]]; then exit 0; fi
    mkdir -p "$MISE_DATA_DIR/installs/quest"
    cat > "$MISE_DATA_DIR/installs/quest/quest" <<'QUEST'
#!/usr/bin/env bash
[[ $1 == --version ]] || exit 1
printf '%s\n' "$INSTALL_TEST_VERSION"
QUEST
    chmod +x "$MISE_DATA_DIR/installs/quest/quest"
    ;;
  which)
    if [[ ${INSTALL_TEST_FALLBACK:-0} == 1 ]]; then
      echo "$RUNNER_TEMP/stale-quest"
    else
      echo "$MISE_DATA_DIR/installs/quest/quest"
    fi
    ;;
  *) exit 1 ;;
esac
MOCK
cat >"$work/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == --proto && $2 == =https && $3 == --tlsv1.2 && $4 == -fLsS ]]
[[ $5 == https://github.com/kixelated/quest/releases/download/v0.1.0/quest-installer.sh && $6 == -o ]]
printf '%s\n' "shell $5" >> "$INSTALL_TEST_LOG"
if [[ ${INSTALL_TEST_DOWNLOAD_FAIL:-0} == 1 ]]; then exit 22; fi
cat > "$7" <<'INSTALLER'
#!/bin/sh
set -eu
if [ "${INSTALL_TEST_MISSING:-0}" = 1 ]; then exit 0; fi
mkdir -p "$QUEST_UNMANAGED_INSTALL"
cat > "$QUEST_UNMANAGED_INSTALL/quest" <<'QUEST'
#!/usr/bin/env bash
[[ $1 == --version ]] || exit 1
printf '%s\n' "$INSTALL_TEST_VERSION"
QUEST
chmod +x "$QUEST_UNMANAGED_INSTALL/quest"
INSTALLER
MOCK
# A system Quest must never be used as a substitute for a missing installation.
cat >"$work/bin/quest" <<'MOCK'
#!/bin/sh
exit 99
MOCK
chmod +x "$work/bin/"*

check() {
    local status=0
    bash "$script_dir/install-check.sh" "$@" >"$work/output" 2>&1 || status=$?
    [[ -z $(ls -A "$work/tmp") ]] || {
        echo 'Install directory was not cleaned up' >&2
        exit 1
    }
    return "$status"
}
reject() {
    if check "$@"; then
        echo "Expected install check to fail: $*" >&2
        exit 1
    fi
    [[ -z $(ls -A "$work/tmp") ]]
}

# Each installer accepts an explicit tag or cargo-dist's reusable-workflow plan.
export RELEASE_TAG=v0.1.0 DIST_PLAN='{"announcement_tag":"v9.9.9"}'
check mise x86_64-unknown-linux-gnu
check shell x86_64-unknown-linux-gnu
export RELEASE_TAG='' DIST_PLAN='{"announcement_tag":"v0.1.0"}'
check mise x86_64-unknown-linux-gnu
check shell x86_64-unknown-linux-gnu
(($(wc -l <"$work/log") == 4))

# Incorrect/missing output and failed downloads must turn the job red.
export INSTALL_TEST_VERSION='quest 0.0.9'
reject mise x86_64-unknown-linux-gnu
reject shell x86_64-unknown-linux-gnu
export INSTALL_TEST_VERSION=''
reject mise x86_64-unknown-linux-gnu
reject shell x86_64-unknown-linux-gnu
export INSTALL_TEST_VERSION='quest 0.1.0'
export INSTALL_TEST_MISSING=1
reject mise x86_64-unknown-linux-gnu
reject shell x86_64-unknown-linux-gnu
unset INSTALL_TEST_MISSING
export INSTALL_TEST_FALLBACK=1
reject mise x86_64-unknown-linux-gnu
unset INSTALL_TEST_FALLBACK
export INSTALL_TEST_DOWNLOAD_FAIL=1
reject shell x86_64-unknown-linux-gnu
unset INSTALL_TEST_DOWNLOAD_FAIL

# Invalid inputs fail before either installer is invoked.
log_lines=$(wc -l <"$work/log")
invalid_plans=('{}' 'null' '{"announcement_tag":7}' '{"announcement_tag":""}' 'invalid')
for plan in "${invalid_plans[@]}"; do
    export DIST_PLAN="$plan"
    reject shell x86_64-unknown-linux-gnu
done
export RELEASE_TAG='../v0.1.0'
reject shell x86_64-unknown-linux-gnu
export RELEASE_TAG=v0.1.0
reject unknown x86_64-unknown-linux-gnu
reject shell aarch64-unknown-linux-gnu
(($(wc -l <"$work/log") == log_lines))

# Enforce native Linux/macOS architecture for all matrix targets.
export INSTALL_TEST_ARCH=aarch64
check shell aarch64-unknown-linux-gnu
export INSTALL_TEST_OS=Darwin INSTALL_TEST_ARCH=arm64
check shell aarch64-apple-darwin
export INSTALL_TEST_ARCH=x86_64
check shell x86_64-apple-darwin
export INSTALL_TEST_OS=Windows
reject shell x86_64-apple-darwin

echo 'release install check: regression tests passed'
