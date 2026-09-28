Keep shared instructions short; place workflow-specific detail in skills or
nested `AGENTS.md` files. State the goal, important constraints, and observable
outcome rather than prescribing a fragile sequence of implementation steps.

Distinguish settled decisions from recommendations and open questions. Preserve
the user's scope and authorization; installing a skill does not authorize future
remote writes or merges. Avoid duplicating instructions across files.

Before changing agent-specific behavior, check the relevant official guidance:

- [Claude project instructions](https://code.claude.com/docs/en/memory)
- [Claude skills](https://code.claude.com/docs/en/skills)
- [Codex instructions](https://developers.openai.com/codex/guides/agents-md)
- [Codex skills](https://developers.openai.com/codex/skills/)

When delegating, provide the concrete task, relevant context, permitted scope,
and expected result. Do not turn a prior failure into a universal rule unless
the general constraint is justified.
