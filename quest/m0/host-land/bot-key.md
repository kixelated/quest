# [XS] moq-bot's App key on the gate host

## Goal

The maintainer's gate host can mint moq-bot installation tokens for
moq-dev/quest from moq-bot's App private key, kept readable only by the user
that runs the gate. Check it by minting a token there and reading the
repository with it. This waits on the maintainer placing the key.

## Plan

Decided 2026-10-30 (user, /quest-plan): the host gate pushes as moq-bot,
which `main`'s ruleset lets bypass the `quest land` check. Today moq-bot's
token comes only from `token.moq.dev` through land.yml's GitHub ID token, which
a host cannot present.

- Accept a key file path or a 1Password `op://` reference, as
  `QUEST_API_KEYS` does.
- Never expose the key or a token to the sandboxed check.
