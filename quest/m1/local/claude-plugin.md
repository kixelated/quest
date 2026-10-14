# [L] Connect local Claude Code sessions to Kix

## Goal

A maintainer without spare API credits uses a Claude Code plugin to plan and
execute Kix work in their normal local Claude session, while decisions and
results stay associated with the project.

## Plan

- The user invokes a plugin command to select work. Use normal local Claude
  authentication; do not extract OAuth credentials or send subscription tokens
  to hosted SDK workers. Kix login is a separate helper or MCP connection.
- Reuse the pinned Quest guide and skills, adapting plugin command names and
  discovery. Load repository instructions explicitly; plugin-root CLAUDE.md
  is not automatically a project's instruction file.
- Sync authorization, claims, questions, progress, and PR results through the
  existing service contract. Do not require a second workflow engine.
- Initial operation is user-invoked. Standard MCP cannot wake an idle session;
  do not depend on research-preview Channels for the initial plugin.
- Verify installation, local account use, reconnect, and cancelled work.
  Extend the guide once the plugin works.
- Sources: [plugins](https://code.claude.com/docs/en/plugins/components),
  [authentication](https://code.claude.com/docs/en/authentication), and
  [Channels](https://code.claude.com/docs/en/channels#how-channels-compare).

## Required

- [Web execution](/quest/m0/kix/execution.md) - reusable service workflow and authorization
