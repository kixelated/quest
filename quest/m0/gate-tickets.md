# [M] Gate admission within a worker's cache

## Goal

Waiting in `quest gate` never outlasts a worker's 5-minute prompt cache. Each
gate call returns within 4 minutes: either admitted, with a token that holds
the slot briefly, or still queued, with a ticket that keeps its place. The
agent runs the command with the token, or calls again with the ticket. Every
tool call stays under the cache lifetime, and admission and queue order work
as they do today.

## Plan

Decided 2026-10-29 (user): sub-agents run with a 5-minute prompt cache and the
coordinator with a 1-hour one (the guide's Workspace section). Today the gate
holds a worker in one blocking call until the host has room, so its next turn
rewrites its whole context. Ticketed admission was picked over removing the
gate and capping spawn concurrency, which would idle agents to cover short
build peaks, and over leaving gated commands to the coordinator alone.

- Admission and the command are separate tool calls: admission waiting plus a
  5-minute command in one call would still exceed the cache.
- Each re-call costs one cached read of the agent's context, about 4 cents for
  200k Opus tokens, against $1 to rewrite it.
- Output during a call does not help: the model sees it only when the call
  returns, and only a request refreshes the cache. Claude Code's `Monitor`
  wakes the agent per output line, but no other harness can, so it is no
  substitute.
- An unused token expires so a vanished agent cannot hold a slot. Size its
  lifetime from measurement, not a guess.
- Update the guide's gate instruction and the [gate bench](/quest/m0/gate-bench.md).

## Related

- [Gate bench](/quest/m0/gate-bench.md) - measure idle-host admission
- [Gate admission on CI](/quest/m0/gate-ci-admission.md) - admission on loaded hosted runners
