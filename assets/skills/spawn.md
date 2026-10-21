---
description: Start multiple quests in parallel.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to execute many quests in parallel.
The scope consists of all ready quests that are not claimed.
Run `quest unblocked --json` for ready candidates in milestone priority, descending downstream impact, then tree order.
The count is distinct transitive dependents; other prerequisites may still remain.
Use that order when dispatching, and recompute after the quest tree changes.
An explicit argument takes precedence: filter to the selected quests/epics and honor their requested order.
Ranking does not establish that work is unclaimed: verify live locks, open changes, and remote branch claims before starting.
For a quest waiting on an outside condition, check whether it has cleared before recommending.

Start every quest you would recommend starting, without asking: well planned, with no blockers or conflicts with quests already started.
Print each quest you skip and why, suggesting `/quest-plan` for any with significant design issues.

Ask only when unsure, such as a quest that may not be worth implementing or may not be worth doing now.
Present those one at a time: a short paragraph explaining the problem, the quest's goal, and your recommendation, then one synchronous question following the guide's Questions section, offering:

- `/quest-start`: If the quest should start now.
- skip: If the quest should not be started yet.
- deprioritize: If the quest should wait behind other work; `/quest-plan` moves it down.
- `/quest-delete`: If the quest should be deleted.

Start each quest in a background sub-agent with its own isolated worktree, since agents cannot write to a worktree their parent created.

Each agent reports back only when done or blocked.
Limit the number of active agents to the physical CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

When done, each agent opens a PR, a draft if decisions or unfinished work remain.
Its report lists every open decision and suggested follow-up with a recommendation.
Report each sub-agent's final status, staying silent on interim notifications, but do not monitor their PRs.

As each agent reports, explain its result in a few lines, then ask about its PR in the same way, offering:

- `/quest-ready`: If the PR is a draft ready for review.
- `/quest-merge`: If the PR is ready for review with no significant issues.
- `/quest-iterate`: If the PR has significant issues or needs decisions.
- skip: If the PR should not be merged yet.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for its suggested follow-ups.
Include quest context, as many quests are concurrently in flight.

Run each selected `/quest-ready`, `/quest-merge`, or `/quest-iterate` in a background sub-agent with its own isolated worktree, as for `/quest-start`.
Run selected `/quest-plan` sessions in the foreground.

Once every sub-agent has finished, remove local worktrees and branches whose tip is the head of a merged PR; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.

## API keys

With an `api` argument, bill agents to API keys instead of this session's account: run each as a headless agent CLI process rather than a sub-agent.
`QUEST_API_KEYS` lists the keys, separated by whitespace; refer to each by its position.
An entry may be a secret reference instead of a key, such as a 1Password `op://` URI.
Resolve every reference in one secret-manager invocation when the spawn starts, such as `op inject` on a template listing each reference, so the user approves at most one prompt and can leave; a 1Password service account token in `OP_SERVICE_ACCOUNT_TOKEN` makes it promptless.
Keep the resolved keys in a file only the user can read, in memory-backed storage such as `$XDG_RUNTIME_DIR` when available, and delete it when the spawn ends.
Children run as the same user and could read that file, so this limits which key each child is given, not what it can reach.
Stop and report if the variable is unset or the agent CLI is not installed.
Never show a key in a command, prompt, log, report, or commit: expand it from that file inside the command.

Start each process in the background, in its own isolated worktree, with JSON output, this session's model, effort, and permission mode passed explicitly, and permission prompts off, so the harness reports its exit as it would a sub-agent's.
For example, `claude -p --output-format json --model <model> --effort <level>` or `codex exec --json`.
Set its key only in that process's environment, as the agent's key variable such as `ANTHROPIC_API_KEY` or `CODEX_API_KEY`, then unset `QUEST_API_KEYS` and secret-manager tokens such as `OP_SERVICE_ACCOUNT_TOKEN` there so it holds no other key, and clear this session's own harness variables, such as every `CLAUDE*` and `ANTHROPIC*` variable for Claude Code, so the process neither reuses this session's credentials nor acts as its sub-session.
Read its final reply and session id from that agent's output: `claude -p` prints one result object with a dollar cost, while `codex exec --json` streams JSONL events, with the thread id in `thread.started`, the reply in the last `item.completed`, and token usage instead of cost.
Report cost only when the agent provides it.
Tell it that it cannot prompt, so it ends with any decisions and its recommendations in its final reply, and that ending its turn ends the process and kills its background commands, so it waits in the foreground.
Ask the user, then resume that session in the background with the answer, as you would message a sub-agent: `claude -p --resume <id>` or `codex exec resume <id>`.

Assign quests to keys round-robin.
When a run fails because its key's credit balance is exhausted, drop that key for the rest of the spawn and resume the session on the next key.
Once every key is exhausted, start nothing new and never fall back to this session's account.
List each interrupted quest with its worktree and session id so the user can resume it later.
