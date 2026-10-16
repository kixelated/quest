# [S] Spawn quests on API keys

## Goal

`/quest-spawn` can optionally start each quest as its own headless agent
process billed to API keys instead of an in-harness sub-agent. Each
process's result and open decisions come back to the spawning session, which
continues it the way it would continue a sub-agent. Given several keys, the
spawn uses them until every one is out of credit.

Non-goals: kix.quest runner integration, spend caps or usage accounting
(provider workspace limits and disabled auto-reload are the backstop), and
storing keys in Quest.

## Plan

Decided 2026-10-16 in the planning interview. Prioritized first in m0 so
expiring promotional API credits (the earliest expires 2026-10-29) fund
quest work instead of going unused.

- Opt in per run with an argument (for example `/quest-spawn api`). Without
  it, spawning is unchanged.
- Agent-neutral: the skill describes a headless agent CLI run with an API
  key, with `claude -p` and `codex exec` as examples. Verify Claude end to
  end in this quest; Codex follows the same contract but is not verified here.
  The agent CLI must already be installed; report it missing rather than
  installing it.
- Skill only, no new CLI code. Launch each quest as a background shell job
  in its own isolated worktree, with JSON output (`--output-format json`,
  `--json`). The harness notifies the parent when the job exits, as with a
  sub-agent. Read the final reply and session id from each agent's own
  output contract: Claude prints one result object with a dollar cost;
  Codex streams JSONL events (`thread.started` carries the thread id, the
  last `item.completed` message is the reply) and reports token usage, not
  cost. Cost is reported only when the agent provides it. Follow-ups resume that session (`claude -p --resume <id>`,
  `codex exec resume <id>`) in the background, in place of messaging a
  sub-agent. A headless child cannot prompt, so it follows the guide's
  fallback: put the question in its final reply and end; the parent asks the
  user and resumes the child with the answer.
- Keys come from one environment variable the user exports, holding a list
  of keys (one per account). Each child gets one key as its provider's key
  variable (for example `ANTHROPIC_API_KEY` or `CODEX_API_KEY`) in its own environment only.
  Never write keys to the repository, logs, prompts, reports, or PRs.
- Rotate and drop: assign quests to keys round-robin. When a run fails
  because its key's credit is exhausted, drop that key for the rest of the
  spawn and resume the quest on the next key. Distinguish exhaustion from
  other failures, which are reported as usual.
- When every key is exhausted, start nothing new. Interrupted quests keep
  their worktrees and session ids; the summary lists them so the user can
  resume them later on a subscription or fresh keys. Never fall back to the
  subscription automatically.
- Children run in the spawning session's permission mode, so they behave as
  sub-agents would. Existing concurrency limits still apply.
- Documentation stays inline: the skill text plus a short README note on the
  argument, the key variable, and setting provider spend limits or disabling
  auto-reload so draining keys cannot charge a card.

## Related

- [Runner](/quest/m0/kix/runner.md) - API-key accounts for kix.quest runners
- [API funding](/quest/m1/cloud/funding.md) - hosted API keys and usage accounting
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - releases agent checkouts; headless children use the same worktrees
