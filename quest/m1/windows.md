# [M] Support native Windows

## Goal

Windows users can install and use Quest natively, without WSL, including local
quest commands and repository setup and removal. Supported agent workflows work wherever their upstream Windows tools
support them. This work is not required for the first public release.

## Plan

Provide native release binaries and documented installation and removal steps.
Choose supported Windows versions and architectures when implementation starts,
based on the Rust toolchain and agent support available then.

Audit filesystem paths, CRLF, process invocation, executable discovery, and Git
worktree behavior. Skill discovery and installation must not assume that Windows
users can create symbolic links. Preserve repository-owned files through setup
and removal using the same rules as other platforms.

Run the core test suite on native Windows CI and verify the adoption lifecycle
in a fresh repository, including paths with spaces and an existing instruction
file. Document any upstream agent limitations and distinguish them from Quest
limitations. Publish Windows artifacts through the existing release process.
