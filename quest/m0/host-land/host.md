# [M] Run the gate on the maintainer's host

## Goal

The maintainer's NixOS host runs `quest land serve` for moq-dev/quest as a
dedicated unprivileged system user under a hardened systemd unit, from
[kixelated/nixos](https://github.com/kixelated/nixos). Each batch's check
and each fixer run happen in an ephemeral systemd-nspawn container whose
network reaches only the package registries and the host's CLIProxyAPI.
Only the gate's user can read moq-bot's App private key, and no container
can read it or the maintainer's Codex login. The Land workflow's
self-hosted `quest-land` runner is retired. Check it by landing a batch, and
by failing to read the bot key from another user and from inside a
container.

## Plan

Decided 2026-10-30 (user, /quest-plan): the host gate pushes as moq-bot,
which `main`'s ruleset lets bypass the `quest land` check.

- Isolation (user, 2026-10-30):
  - ✅ A dedicated user plus the sandbox
  - A microVM per batch
  - A separate machine
- No GitHub Actions (user, 2026-10-30). The host already runs the
  `quest-land` Actions runner
  ([kixelated/nixos@6e28c62](https://github.com/kixelated/nixos/commit/6e28c62)):
  an ephemeral nspawn container that registers through moq-bot (App
  1039466). Moving land.yml onto it was recommended; the user asked what
  Actions still provides. Its only real value was public logs, so the gate
  drops it.
  - land.yml on the quest-land runner
  - ✅ The daemon, outside Actions
- Sandbox (user, 2026-10-30):
  - ✅ An nspawn container per batch, following `modules/ci-runners.nix`:
    a private network, mapped UIDs, and nothing of the host's home
    directories, secrets, or SSH agent
  - Bubblewrap through `src/runner/sandbox.ts`
- The daemon starts the container through a command the host provides, so
  the quest code stays host-agnostic; this quest writes that command.
- Give the gate its own copy of moq-bot's key through systemd
  `LoadCredential`, as `cliproxyapi.service` loads its keys. The runner's
  copy goes away with the runner.
- Codex reaches its model through CLIProxyAPI
  ([kixelated/nixos#13](https://github.com/kixelated/nixos/pull/13), deployed
  but not merged), billed to the maintainer's ChatGPT Codex account and its
  credits (user, 2026-10-30). That module loads only Claude accounts today,
  so add the maintainer's Codex (ChatGPT) OAuth login to it as another
  credential. It listens on the container network's host address too. Proxy over a key in the sandbox:
  - Capped API key, no git creds
  - ✅ Key via proxy, through the CLIProxyAPI already running here
- The gate gets its own CLIProxyAPI client key, so it can be revoked alone.
  The container sees only that client key.
- Harden the unit: `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome=yes`, `PrivateTmp`, and a state directory for the checkout
  and the logs.

