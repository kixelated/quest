# [M] Show what agents are working on through summaries

## Goal

A signed-in maintainer sees every active agent job on their projects as a
card beside the decision inbox: its quest or PR, its state (working, waiting
on you, PR open, stopped, account limited, runner offline), its runner and
account, the latest agent-written summary, and the time since that update. The quest map also highlights
active jobs as a secondary view. A job's raw agent output is collapsed behind
a per-job disclosure that only the project's current maintainers can expand.

## Plan

Decided 2026-10-15 in the decisions-not-implementations interview:

- Summaries and prompts are the whole default UI. Raw output is never shown
  by default, never streamed to the page, and loads only when a maintainer
  expands it. Other viewers never see raw output.
  The operator inspects transcripts through service tooling, not this UI.
- Agent checkpoints produce the summaries: the runner exposes a structured
  status tool the agent calls at meaningful steps, and every terminal result
  must carry a summary. No separate summarizer model. A job that stays quiet
  past a threshold shows "no update since …" rather than a guess.
- Cards are the primary view and must work on a phone. Map highlights reuse
  the existing quest map and card data; they add no separate state.
- Summaries are untrusted agent text. Render them as escaped text or safe
  Markdown, and never treat one as approval or as a decision answer.
- Check maintainer authority on every raw-output request, not just when the
  page loads, and test that other users and revoked maintainers are
  refused.

## Required

- [Runner](/quest/m0/kix/runner.md) - the checkpoint tool, summaries, and retained raw output
- [Decision inbox](/quest/m0/kix/prompts.md) - the signed-in shell the cards sit beside
