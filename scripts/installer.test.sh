#!/usr/bin/env bash
# Offline regressions for the release shell installer against a local release.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/quest-installer-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/release"
export PATH="$work/bin:$PATH"
export INSTALL_TEST_OS=Linux INSTALL_TEST_ARCH=x86_64 INSTALL_TEST_ROSETTA=0

cat >"$work/bin/uname" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  -s) echo "$INSTALL_TEST_OS" ;;
  -m) echo "$INSTALL_TEST_ARCH" ;;
  *) exit 1 ;;
esac
MOCK
cat >"$work/bin/sysctl" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == -n && $2 == hw.optional.arm64 ]]
echo "$INSTALL_TEST_ROSETTA"
MOCK
chmod +x "$work/bin/"*

# A release whose binary for each target prints that target.
targets=(x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-apple-darwin aarch64-apple-darwin)
for target in "${targets[@]}"; do
    mkdir -p "$work/build/$target"
    printf '#!/bin/sh\necho "quest 0.1.0 %s"\n' "$target" >"$work/build/$target/quest"
    chmod +x "$work/build/$target/quest"
    tar -czf "$work/release/quest-$target.tar.gz" -C "$work/build/$target" quest
done
(cd "$work/release" && sha256sum quest-*.tar.gz >SHA256SUMS)

export QUEST_DOWNLOAD_URL="file://$work/release"
export QUEST_INSTALL_DIR="$work/install"
install() {
    sh "$script_dir/installer.sh" >"$work/output" 2>&1
}
reject() {
    if install; then
        echo "Expected the installer to fail for $INSTALL_TEST_OS/$INSTALL_TEST_ARCH" >&2
        exit 1
    fi
}
expect() {
    install || {
        cat "$work/output" >&2
        exit 1
    }
    [[ $("$QUEST_INSTALL_DIR/quest") == "quest 0.1.0 $1" ]]
    [[ -z $(find "$QUEST_INSTALL_DIR" -name '.quest.tmp') ]]
}

# Each supported platform installs its own binary, replacing an earlier one.
expect x86_64-unknown-linux-gnu
grep -qF "Add $QUEST_INSTALL_DIR to PATH" "$work/output"
INSTALL_TEST_ARCH=aarch64 expect aarch64-unknown-linux-gnu
INSTALL_TEST_ARCH=arm64 expect aarch64-unknown-linux-gnu
INSTALL_TEST_OS=Darwin INSTALL_TEST_ARCH=arm64 expect aarch64-apple-darwin
INSTALL_TEST_OS=Darwin expect x86_64-apple-darwin
# A shell under Rosetta still gets the Apple silicon binary.
INSTALL_TEST_OS=Darwin INSTALL_TEST_ROSETTA=1 expect aarch64-apple-darwin
PATH="$QUEST_INSTALL_DIR:$PATH" expect x86_64-unknown-linux-gnu
if grep -q 'to PATH' "$work/output"; then
    echo 'Expected no PATH hint when the directory is on PATH' >&2
    exit 1
fi

# Unsupported platforms, bad checksums, and missing files install nothing.
rm -rf "$QUEST_INSTALL_DIR"
INSTALL_TEST_OS=FreeBSD reject
INSTALL_TEST_OS=Windows_NT reject
cp "$work/release/quest-aarch64-apple-darwin.tar.gz" "$work/release/quest-x86_64-unknown-linux-gnu.tar.gz"
reject
grep -qF 'checksum mismatch for quest-x86_64-unknown-linux-gnu.tar.gz' "$work/output"
rm "$work/release/quest-x86_64-unknown-linux-gnu.tar.gz"
reject
rm "$work/release/SHA256SUMS"
INSTALL_TEST_ARCH=aarch64 reject
[[ ! -e $QUEST_INSTALL_DIR/quest ]]

# The template refuses to run, and a published installer downloads its own tag.
unset QUEST_DOWNLOAD_URL
reject
grep -qF 'unreleased template' "$work/output"
cat >"$work/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$5" >>"$INSTALL_TEST_LOG"
exit 22
MOCK
chmod +x "$work/bin/curl"
export INSTALL_TEST_LOG="$work/curl.log"
sed 's/@TAG@/v0.1.0/' "$script_dir/installer.sh" >"$work/quest-installer.sh"
if sh "$work/quest-installer.sh" >"$work/output" 2>&1; then
    echo 'Expected the failed download to stop the installer' >&2
    exit 1
fi
[[ $(cat "$INSTALL_TEST_LOG") == https://github.com/kixelated/quest/releases/download/v0.1.0/quest-x86_64-unknown-linux-gnu.tar.gz ]]

echo 'release installer: regression tests passed'
