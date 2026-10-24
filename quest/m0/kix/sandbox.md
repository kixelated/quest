# [L] Run untrusted PR heads on sandboxed runners

## Goal

Jobs on PR heads containing non-maintainer commits route to Linux runners,
which build the PR's devShell in a per-job VM before its commands run in the
OS sandbox every Claude Code job already uses. opencode jobs' commands run in
that sandbox too. kix classifies PR heads whose commits all
come from maintainers or kix jobs as trusted, so those run on any runner. The
sandbox is verified on macOS, and the owner's approval of another
maintainer's answer is lifted once it is.

## Plan

Decided 2026-10-15, from Codex's review of kixelated/quest#121:

- A Nix devShell is not an isolation boundary, and maintainers' machines
  must not run contributor-controlled code unconfined. Sandbox all jobs, not
  just untrusted ones: one execution path, which also contains prompt
  injection from untrusted issue text.
- OS sandbox, not a VM per job: bubblewrap on Linux and Seatbelt on macOS.
  Claude Code's docs say this does not replace a container or VM; the README
  documents that residual risk.
- Job coordination marks every `iterate` job untrusted and routes it only to
  Linux runners that register with `vm: true`. Classify PR heads whose commits
  all come from maintainers or kix jobs as trusted here.
- Untrusted heads: evaluate and build the PR's own devShell in a per-job
  KVM microVM on a Linux runner, then bring the closure into the host store
  and run the job's commands in the OS sandbox. Verify how to import unsigned
  paths without making the runner trust arbitrary builders, and never
  publish them to the shared cache. The runner refuses untrusted jobs until
  then.
- macOS runners take trusted revisions only, since a Linux VM cannot build a
  darwin devShell. An untrusted-head job waits with "needs a Linux runner"
  while none is online. Cloud runners are Linux-only.
- Decided 2026-10-22 on
  [kixelated/quest#188](https://github.com/kixelated/quest/pull/188), from
  Codex's security review: a job resumes with an answer from a maintainer
  other than the runner's owner (the job's requester) only after the owner
  approves it in the inbox, since the agent would act on that text with the
  owner's machine. kix holds the job and the runner refuses an answer
  without `approvedAt`. The sandbox lifts this gate: remove the approval step
  from kix, the inbox, and the runner.

Shipped in [kixelated/quest#212](https://github.com/kixelated/quest/pull/212)
(`src/runner/sandbox.ts`), and verified live on Linux with Claude Code
2.1.291 and 2.1.305:

- Claude Code's sandbox runs every command in `dontAsk` mode with
  `--setting-sources user`, since a checkout's `.claude/settings.json` hooks
  run outside the sandbox even in `-p` mode. The file tools edit and read
  only the checkout, and WebFetch is off.
- The runner builds the devShell with `nix print-dev-env` from the job's
  revision in the bare clone, never the edited checkout, and Claude Code
  sources it through `CLAUDE_ENV_FILE` inside the sandbox, shellHook
  included.
- Commands have no Nix daemon: on Linux the sandbox's seccomp filter
  refuses Unix sockets, and allowing them all would expose every socket on
  the filesystem, while a trusted Nix user could reach the daemon's
  root-level options. `nix build` and `nix flake check` run in CI instead.
- Decided 2026-10-24 on
  [kixelated/quest#212](https://github.com/kixelated/quest/pull/212): a
  trusted revision's commands reach a fixed list of package registries
  (npm, crates.io's index and downloads, PyPI), since most repositories
  cannot run their checks without installing dependencies. An untrusted
  revision's commands reach no network host. The answer-approval gate stays
  until the sandbox is verified on macOS.

Remaining work:

- opencode has no native sandbox, and its jobs' commands still run unconfined
  on the host (in the revision's devShell, with the attempt's private HOME).
  Decided 2026-10-15: run `opencode serve` under Anthropic's sandbox-runtime
  with the runner's `Sandbox` policy (`src/runner/sandbox.ts`). The runner
  reaches the server on localhost, and opencode needs its providers' hosts,
  so check both under sandbox-runtime's network isolation. Keep the account's
  login out of what the commands can read: verify how much of its XDG home the
  wrapped process exposes, and deny reads of every other account home.
  Commands also inherit the per-turn `OPENCODE_SERVER_PASSWORD`, and the kix
  tools' bearer token in `OPENCODE_CONFIG_CONTENT`; keep both out of reach.

- On macOS, sandboxed commands cannot reach the account's Keychain item
  (`security find-generic-password`), `/private/var/folders`, or another
  home, and the realpath'd `/private/tmp` directory works as `TMPDIR`.
- On Ubuntu 23.10 and later, unprivileged user namespaces need an AppArmor
  profile for the runner; document one and fail fast when the sandbox cannot
  start, instead of failing each job.
- Sources:
  [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
  and [sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime).
