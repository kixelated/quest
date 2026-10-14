# [M] Let maintainers opt Quest repositories into contributions

## Goal

A maintainer installs the GitHub App, selects a public open-source repository
with Quest files, and explicitly enables contributions. The service verifies
their authority and presents the project's ready quests. The maintainer can
pause contributions or disconnect the project.

## Plan

- Quest files are required, chosen over native-issue-only intake on
  2026-10-13. Help repositories without Quest follow the existing setup path;
  do not silently change their repository or require a forge migration.
- Repository installation and contribution opt-in are distinct actions.
  Explain that opting in makes ready quests on the default branch eligible
  for funded implementation; there is no second approval flag per quest.
- Keep setup short and separate from the main decision inbox. Preserve the
  project's normal GitHub issues, review rules, CI, and merge protections.
- Planning and funding controls require current maintainer authority.
  Donors may fund eligible work but do not gain maintainer permissions.
- Reuse appropriate parts of existing login/board code. Artifacts import,
  contributor fork issue-files, and automatic issue promotion are abandoned.

## Required

- [GitHub App](/quest/m0/kix/github.md) - installation identity and verified repository authority
