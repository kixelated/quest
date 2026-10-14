# [M] Support native Windows

## Goal

Windows users can install and use Quest natively, without WSL, including local
quest commands and repository setup and removal. Supported agent workflows work wherever their upstream Windows tools
support them. This work is not required for the first public release.

## Plan

Provide native release binaries and documented installation and removal steps.
Choose supported Windows versions and architectures when implementation starts,
based on Bun's compile targets and agent support available then.

Audit filesystem paths, CRLF, process invocation, executable discovery, and Git
worktree behavior. Skill discovery and installation must not assume that Windows
users can create symbolic links. Preserve repository-owned files through setup
and removal using the same rules as other platforms.

Run the core test suite on native Windows CI and verify the adoption lifecycle
in a fresh repository, including paths with spaces and an existing instruction
file. Document any upstream agent limitations and distinguish them from Quest
limitations. Publish Windows artifacts through the existing release process.


Implementation prepared on 2026-10-13: Windows x64 and ARM64 targets both
compile with pinned Bun 1.4.2. New installs use independent real skill trees,
existing links remain supported, CRLF stubs are recognized, and instruction
newline style survives removal. Shared native lifecycle coverage exercises
paths with spaces and actual Git worktrees. Windows CI and native release
archive/mise checks are wired into the existing workflows.

Native execution and PowerShell installation cannot be verified on this Linux
host. Keep this quest until Windows CI passes for both architectures and the
first release's archive/mise checks verify published artifacts. No release was
published as part of this implementation. Source and release support are
recorded in docs/windows.md with current primary upstream references.
