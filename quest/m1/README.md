# Later work

## Goal

Extend the hosted decision UI with local API workers and a Claude Code plugin,
donated reviews and CI, stronger local isolation, and additional login providers.
This milestone does not gate the first release.

## Required

- [Local integrations](/quest/m1/local/README.md) - explicit API-worker CLI, API workflow variants, Claude plugin, and donor runner
- [Review and check automation](/quest/m1/automation/README.md) - donated reviews, CI, and optional Nix caching
- [Donor isolation](/quest/m1/donor-isolation.md) - stronger boundaries for untrusted local jobs
- [ChatGPT hosted runs](/quest/m1/chatgpt-hosted.md) - conditional on provider approval and current terms
- [ChatGPT approval](/quest/m1/chatgpt-waitlist.md) - resolve hosted-use approval before implementation
