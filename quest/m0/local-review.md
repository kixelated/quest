# [L] Review locally with the other vendor's model

## Goal

Before pushing for review, the authoring session commits, passes local checks,
then has the other vendor's model (Claude Code reviews Codex's work, Codex
reviews Claude Code's) adversarially review the committed branch on this
machine. It fixes or refutes the findings, and only then pushes and marks the
PR ready. GitHub's role shrinks to triggering the free online reviewers and
acting as the final merge gate. Their already-posted findings are addressed
at merge, never waited for.

Non-goals: kix runner jobs (see
[donated reviews](/quest/m1/automation/review.md)), posting findings as
GitHub review threads, and reviewing a remote PR without a local checkout.

## Plan

Decided 2026-10-28 (user, /quest-plan):

- `quest review` (CLI) and `/quest-review` (skill). The skill replaces
  `/quest-ready`: it runs local checks and the review loop (or records a
  skip), writes the PR's `## Review` section, pushes, marks the PR ready with
  the existing `quest ready` hold, then offers `/quest-merge`. `/quest-start`,
  `/quest-iterate`, `/quest-complete`, `/quest-spawn`, `/quest-afk`, and
  README call it where they called `/quest-ready`.
- The CLI reviews the current checkout's committed branch against its base.
  To review someone else's PR, the agent checks out its head first, since it
  runs checks and makes changes there anyway.
- It detects the running harness from its environment and launches the
  other one. `--harness` overrides that. An unknown harness (such as
  opencode), or a missing or logged-out CLI, is an error, never a same-model
  fallback. It uses the other CLI's own login and config: model and effort
  come from that CLI's defaults, with `--model`/`--effort` passed through.
  Quest hardcodes no model ids.
- Engine: each PR's first round runs the vendor's maintained reviewer, then
  resumes that session for one quest-owned follow-up turn. The reviewers are
  `codex exec review --base <base>` and
  `claude -p "/code-review high <base>...HEAD"`. The follow-up carries the
  base's `REVIEW.md` and asks for the merged findings in one JSON schema
  (`--output-schema` / `--json-schema`). Quest's own prompt stays neutral:
  the repository's `REVIEW.md` chooses the stance (such as adversarial) and
  overrides the built-in reviewers' defaults. The Codex plugin's
  `adversarial-review` prompt is a good starting point for a repository that
  wants one. Later rounds resume the same session with the new head
  and the author's free-text responses (fixes and refutations). The reviewer
  accepts a refutation unless it defends the finding with new evidence.
  Without them, rejected findings would recur every round.
- Read-only: Codex in its `read-only` sandbox; Claude restricted to read
  tools and read-only git commands. Never a write tool or a permission bypass.
- Cache: always resume. Request Claude's 1h prompt-cache TTL and OpenAI's
  24h retention explicitly. The PR shows from usage output that a resumed
  round reads the cache. A cold resume is accepted: it costs one rewrite and is
  still cheaper than a fresh review.
- Instructions come from the base: `REVIEW.md` is optional and read with
  `git show <base>:REVIEW.md`. For a head whose `AGENTS.md`/`CLAUDE.md`
  differ from the base's, the reviewer follows the base's copies, so a PR
  cannot instruct its own reviewer. Hosted Claude Code Review does the same
  with `REVIEW.md`. Find the mechanism, such as `--ignore-rules` or
  restoring the base's files in a scratch worktree. If none is clean, ask in
  the PR. `quest init` does not scaffold `REVIEW.md`. Without one, a round
  adds no rules to the built-in review.
- The authoring model decides whether a change is too trivial to review. A
  skip is recorded in `## Review` with its reason, and that record satisfies
  the guide's review rule like a review does.
- Record: the PR body's `## Review` section names the reviewer harness and
  model, the reviewed SHA, and each finding's disposition (fixed, or refuted
  with the reason), or the skip and its reason. It is rewritten after each
  round. A review counts for the head whose SHA it names. The guide's
  exemptions (conflict-free base merge, reviewer patch applied unchanged)
  still apply.
- Online reviewers (CodeRabbit, ChatGPT, Codex cloud): `/quest-merge` reads
  and addresses findings already posted on the head, and never waits for or
  requests one, including `@codex review` nudges. Fixing them changes the
  head, so the local loop reruns before pushing.
- The guide's every-fourth-round design checkpoint counts local review
  rounds. Otherwise local fixes would never reach it.
- Rewrite the guide's Reviews section, `/quest-merge`'s waits, README, and
  this repository's `CONTRIBUTING.md` review policy to match. Update
  [Land only reviewed heads](/quest/m0/kix/land-review.md) so its policy
  example names the `## Review` record instead of Codex.
- Tests mock both harness CLIs: harness detection, missing/logged-out
  CLI errors, resume with responses, base-only instructions, and schema
  parsing failures.
- After landing, retire the maintainer's dotfiles `peer-review` skill,
  which this supersedes.

## Related

- [Turn off Codex cloud reviews](/quest/m0/codex-cloud-off.md) - once no open PR relies on it
- [Land only reviewed heads](/quest/m0/kix/land-review.md) - kix's merge gate reads the same record
- [Donate independent agent reviews](/quest/m1/automation/review.md) - the hosted counterpart for kix jobs
