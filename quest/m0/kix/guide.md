# [M] Guide maintainers and donors through Kix

## Goal

A dedicated guide takes a maintainer from project enrollment through an
issue's planning interview, a funded implementation, and a reviewed GitHub
PR. A donor can set up an API key, select allowed work and a budget, inspect
usage, and stop funding without guessing how the service works.

## Plan

- User chose a separate end-to-end guide on 2026-10-13. Individual features
  still update any existing documentation they make stale.
- Keep the product path centered on decisions and prompts. Explain
  repository opt-in, Quest-file requirements, GitHub App permissions, who
  can answer, and how draft plans become eligible after merging.
- Explain named API accounts, maintainer-paid planning, explicit donor
  planning consent, project and per-quest allocations, estimates,
  in-flight usage, provider limits, and revocation.
- Document creating Console keys and claiming eligible monthly credits,
  with current official sources. Distinguish supported API billing from
  unverified promotional-donation claims and ordinary chat subscriptions.
- Include operator registration, fork ownership, hosting limits, and recovery
  in an operator section. Keep those details out of the maintainer's normal
  decision flow.
- Extend the guide when local CLI/plugin support ships; do not advertise
  future local integrations as available. CLI reference changes remain in
  their own feature quests.
- Validate the guide against the running UI and a real pilot repository.

## Required

- [Web execution](/quest/m0/kix/execution.md) - the complete user flow being documented
- [Operator setup](/quest/m0/kix/operator-setup.md) - verified deployment and App setup
