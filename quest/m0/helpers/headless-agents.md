# [M] Headless agents for billed spawns

## Goal

`/quest-spawn api` starts, resumes, and stops each billed agent through one
`quest` command instead of a launcher every session writes again, and Claude
Code's auto mode allows those commands on the user's invocation alone, with no
per-user settings.

## Plan

Found on 2026-10-20 running `/quest-spawn api` in moq-dev/moq (16 quests,
three keys):

- The session hand-wrote a launcher: resolve `QUEST_API_KEYS` with one
  `op inject`, strip the harness's `CLAUDE*`/`ANTHROPIC*` variables, pass one
  key, hold launches on load, capture JSON output, and resume a session on the
  next key when credit ran out.
- The auto-mode classifier blocked 5 commands, including 3 of about 25
  launches and resumes that matched ones it allowed, under "Create Unsafe
  Agents", "Unauthorized Persistence", and "Credential Materialization". The
  classifier reads user messages, CLAUDE.md, and tool calls, not tool results
  ([docs](https://code.claude.com/docs/en/permission-modes)). The spawn
  instructions arrive as `quest skill spawn` output, so it saw only an opaque
  `run.sh` that hid `--permission-mode auto`, next to variable stripping and
  key handling.
- Decided (user, 2026-10-20): no settings fix. A prose `autoMode.allow` entry
  in `~/.claude/settings.json` would work, but every user would have to add it.

Recommended shape, open for review:

- A `quest agent` command (name open) with `start`, `resume`, and `stop`. Its
  own argv shows the harness, worktree, key index, model, effort, and
  permission mode; it never prints a key. It reports the session id, final
  reply, and cost, and exits with a distinct status when a key's credit is
  exhausted, so the skill moves to the next key without parsing output.
- Each dispatching skill's stub body states what invoking it authorizes:
  starting, resuming, and stopping background agents in isolated worktrees,
  and with `api`, billing them to the user's keys. Stub text is part of the
  user turn the classifier reads. Open: stubs are static by design ("the stub
  never changes between versions"), so this changes their contract once.
  Rerunning `quest init` is not enough: `init` and `uninstall` accept only a
  stub that exactly matches the current text, so `init` refuses an older stub
  and `uninstall` leaves it in place. Existing repositories need an upgrade
  path, such as `init` and `uninstall` also recognizing known older stub texts,
  or a manual remove-and-reinit; that cost counts against this option. The
  alternative is to rely on the command's legibility alone. Replay the
  2026-10-20 commands against each option before choosing.
- The spawn skill's launcher prose shrinks to calling the command.
- Validate with a multi-agent `api` spawn in a repository with no `autoMode`
  settings: no classifier blocks, and exhausted keys hand off without the
  coordinator writing a script.

## Related

- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes the load-average rules this command would otherwise carry
- [Expensive command gate](/quest/m0/local-gate.md) - admission the command should use instead of polling load
- [Runner](/quest/m0/kix/runner.md) - the kix runner's headless Claude Code path; share the adapter
