# [L] Fund cloud runners with API keys and donor allocations

## Goal

A maintainer connects API keys for any provider the runner's adapters
support, and cloud-runner jobs use them, or an eligible donor allocation
funds them. Donors can authorize a project budget
or fund an individual quest, inspect usage, pause funding, and revoke their
key. Concurrent jobs respect the same durable accounting.

## Plan

- Moved from m0 on 2026-10-15: own-machine runners use their machine's own
  logins, so kix holds no provider keys until cloud runners exist.
- Store named account/key references per user so people with multiple
  accounts select the intended payer. Keep accounts distinct; one attempt
  uses one explicit account/allocation. Never silently switch keys or fall
  back to the maintainer's paid account when funding runs out.
- Planning defaults to the maintainer's key. Donors explicitly choose
  whether an allocation permits planning, implementation, or both. A
  project planning allocation may fund an authorized interview before its
  new quests exist; implementation funding only applies to eligible work.
- Support project/month allocations and individual-quest allocations.
  Attribute each charge once to its selected allocation and any applicable
  donor-wide limit. A contribution is API-funded work, not transferred cash.
- Keep real provider keys outside untrusted runner containers. A constrained
  credential proxy authorizes each run's supported requests, routes them
  to the chosen account, and records usage. Use revocable job credentials
  inside executors rather than exposing the donor's key.
- Reserve against applicable budgets atomically before admitting requests;
  reconcile against returned usage and retain reservations for uncertain
  outcomes. Do not give concurrent workers separate copies of a balance.
  Stop new requests on exhaustion/revocation; in-flight requests may still
  finish and be billed.
- Be honest about estimates and in-flight costs. SDK `maxBudgetUsd` is a
  post-response threshold that can overshoot and resets across calls; it
  does not implement a shared monthly cap. Use it as an additional control.
  Document provider workspace limits as an independent backstop.
- Ordinary API keys have no documented promotional-balance or promo-only
  control. Anthropic spends promotional credits before purchased/invoiced
  funds. Do not advertise automatic harvesting of only unused credits, and
  do not ask for broad Admin API credentials to accept a donation.
- Hosted API-key use is documented; the published credit terms do not
  explicitly approve this donation model. Clearly separate verified API
  eligibility from assumptions about promotional funding; verify applicable
  provider terms before making public promotional-credit claims.
- Hosting is paid by kix.quest under a separate operator limit until
  [paid compute](/quest/m1/cloud/billing.md) ships. Donor API
  authorization never silently pays compute charges.
- Sources:
  [monthly credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans),
  [secure SDK deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment),
  [SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking),
  and [Console usage APIs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).
