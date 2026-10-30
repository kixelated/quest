# [S] The gate host's user, moq-bot key, and Codex access

## Goal

The maintainer's gate host has a dedicated unprivileged system user that runs
the gate under a hardened systemd unit. Only that user can read moq-bot's App
private key, and nothing the gate sandboxes can read it or the maintainer's
Codex login; sandboxed Codex holds only the gate's revocable CLIProxyAPI
client key. Check it by minting a moq-bot token as that user and reading the
repository with it, and by failing to read the bot key from another user and
from inside the sandbox. Placing the bot key and issuing the client key
wait on the maintainer.

## Plan

Decided 2026-10-30 (user, /quest-plan): the host gate pushes as moq-bot,
which `main`'s ruleset lets bypass the `quest land` check. Today moq-bot's
token comes only from `token.moq.dev` through land.yml's GitHub ID token, which
a host cannot present.

- Isolation (user, 2026-10-30):
  - ✅ A dedicated user plus the sandbox
  - A microVM per batch
  - A separate machine
- Store the keys as files the gate user alone can read (mode 0400), or as
  1Password `op://` references as `QUEST_API_KEYS` does. Never put the bot key
  in a sandboxed process's reach.
- Harden the unit: `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome=yes` apart from the gate's own state directory, `PrivateTmp`,
  and no other users' files. The gate still needs unprivileged user
  namespaces for bubblewrap (see
  [AppArmor](/quest/m0/kix/sandbox/apparmor.md) on Ubuntu).
- Codex reaches its model through the host's CLIProxyAPI service
  (`cliproxyapi.service`, `127.0.0.1:8317`), which holds the maintainer's
  Codex login in systemd credentials and bills the Codex plan's credits
  (user, 2026-10-30). Proxy over a key in the sandbox:
  - Capped API key, no git creds
  - ✅ Key via proxy, through the CLIProxyAPI already running here
- The gate gets its own CLIProxyAPI client key, so it can be revoked
  alone. The sandbox can see that client key; it reaches only the proxy, and
  the login itself stays outside.
