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


Deployed 2026-10-30 from
[kixelated/nixos#16](https://github.com/kixelated/nixos/pull/16) (live as
`deploy/quest-land`):

- `quest-land.service` runs the daemon as its own user with the bot key
  through `LoadCredential`. Each check runs in an ephemeral nspawn container
  started by a root-owned socket launcher that accepts uploads only from that
  user. Egress follows the CI runners' public-IPv4 policy (user, 2026-10-30),
  not a registry allowlist.
- moq-bot gained Checks read, Commit statuses read, Administration read, and
  Issues write (user, 2026-10-30), since the daemon reads the queue as
  moq-bot where land.yml used Actions' own token.

- The check container boots systemd with a user manager for the check user
  (user, 2026-10-30), as the gate's own tests need systemd scopes, and has
  the CI runners' tools. nspawn keeps the image's public resolvers, since the
  host's Tailscale MagicDNS is beyond egress.
- The first live batch landed on 2026-10-30:
  [moq-dev/quest#299](https://github.com/moq-dev/quest/pull/299) and
  [#300](https://github.com/moq-dev/quest/pull/300) together, then
  [#301](https://github.com/moq-dev/quest/pull/301). moq-bot's API squash
  merge bypasses the unreported `quest land` check.
- The `quest-land` Actions runner is retired, and the host pins quest at
  `49cd094`, whose checks get a standalone shallow clone.

What remains:

- Merge #16 once
  [kixelated/nixos#13](https://github.com/kixelated/nixos/pull/13) lands.
- The fixer's container access to CLIProxyAPI and the Codex login, which the
  [fixer](/quest/m0/host-land/fixer.md) needs.
- VM tests for three more symlink attacks (an escaping chain, a link to a
  directory, a write through a symlinked directory), which the extraction
  already rejects.
- moq-bot's `organization_self_hosted_runners` write permission served only
  the retired runner; the maintainer may drop it.
- Keep fixers running across a deploy: set `KillMode=process` on each
  `quest-land-<repo>.service` in `modules/quest-land.nix`. The default
  `control-group` sends SIGTERM to the daemon's detached fixer supervisor
  too, so a fixer running during a deploy ends with exit 143. On 2026-10-31
  that happened to moq's 23:22 batch
  ([moq-dev/moq#7426](https://github.com/moq-dev/moq/pull/7426),
  [moq-dev/moq#7084](https://github.com/moq-dev/moq/pull/7084)). The
  daemon's in-flight check clients still exit on their next write to the
  dead daemon's pipe. Check it by restarting the unit while a fixer runs:
  the job should collect a result, not a handback naming SIGTERM. Keep
  `ProcSubset=pid` off the unit: generation 45 had it, which hid
  `/proc/sys/kernel/random/boot_id` from the daemon.
