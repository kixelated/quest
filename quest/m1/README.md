# Later work

## Goal

Extend kix.quest with cloud runners, a native mobile app, runners shared
with other projects, donated reviews and CI, stronger isolation, and
additional login providers. This milestone does not gate the first release.

## Required

- [Cloud runners](/quest/m1/cloud/README.md) - one-click free cloud runners, API-key and donor funding, then paid compute
- [Native mobile app](/quest/m1/mobile-app.md) - push notifications with quick replies to decisions
- [Shared runners](/quest/m1/donor-runner.md) - offer your runner and accounts to other projects
- [Review and check automation](/quest/m1/automation/README.md) - donated reviews, CI, and a shared Nix cache
- [Donor isolation](/quest/m1/donor-isolation.md) - stronger boundaries for untrusted shared jobs
- [ChatGPT hosted runs](/quest/m1/chatgpt-hosted.md) - conditional on provider approval and current terms
- [ChatGPT approval](/quest/m1/chatgpt-waitlist.md) - resolve hosted-use approval before implementation
- [Merge-job extensions](/quest/m1/merge-jobs.md) - submodule pointers, continuing from a moved head, and webhook wakeups
- [Live inbox](/quest/m1/inbox-polish.md) - live agent cards, active quests on the log, runner choice for every job, expiring offers
- [Worker dev setup](/quest/m1/worker-dev.md) - per-server cookies, seeded raw output, one fake GitHub, each test run alone
- [Merge driver tuning](/quest/m1/resolve-tuning.md) - measure `quest resolve` on moq's history and match git's markers
- [Batched inbox reads](/quest/m1/inbox-reads.md) - a fixed number of D1 queries per project on each inbox load
- [Incremental history](/quest/m1/history-pass.md) - each history pass reads only what changed since the last
