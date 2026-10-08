# [M] Use ChatGPT for web login and hosted runs

## Goal

Contributors sign in to the web UI with ChatGPT and fund hosted Sandbox runs
from their ChatGPT plan. This works within OpenAI's terms for hosted apps.

## Plan

Self-hosted runners already spend a contributor's ChatGPT plan from their own
machine in a0 ([runner daemon](/quest/a0/cloudflare/runners/daemon.md)); this
quest is for the hosted Sandbox runner and web login.

Re-check the terms once approved. As of 2026-10-01, they reportedly require
requests from the user's local runtime or a remote runtime only that user
controls.

## Required

- [ChatGPT approval](/quest/a1/chatgpt-waitlist.md) - OpenAI must approve hosted use
- [Quest on Cloudflare](/quest/a0/cloudflare/README.md) - the app this extends
