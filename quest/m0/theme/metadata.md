# [XS] Set the GitHub repository description, topics, and homepage

## Goal

The GitHub repository shows the quest-log hook, a set of topics, and
`https://kixel.quest` as its homepage before the 2026-10-14 demo.

Waits on a maintainer approving the values below. Then run:

```sh
gh repo edit kixelated/quest \
  --description "A quest log for your repo and your agents: plans as Markdown files, explicit dependencies, and reviewable Git changes. For Claude Code and Codex." \
  --homepage https://kixel.quest \
  --add-topic ai-agents,coding-agents,agent-skills,claude-code,codex,project-planning,roadmap,markdown,git,cli,cloudflare-workers
```

Check with `gh repo view kixelated/quest --json description,homepageUrl,repositoryTopics`;
delete this quest once it shows the approved values.

## Plan

- Split from the copy rewrite on 2026-10-07: the README and docs landed in the
  quest-log voice, and setting repository metadata is a maintainer action on
  GitHub, so it waits here instead of blocking that PR.
- The description leads with the hook, then the substance, as
  [the quest log theme](/docs/theme.md) asks, and stays well under GitHub's
  350-character limit.
- Topics describe what Quest is and who it is for; `cloudflare-workers` covers
  the site and board. Drop it if the hosted side should not be advertised yet.
