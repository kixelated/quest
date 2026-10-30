# [S] moq-dev/quest lands through quest land

## Goal

PRs to moq-dev/quest's `main` land only through
`quest land`, on a hosted runner, running
`just check` and `just test` once per batch. GitHub's merge button cannot
land around it. A PR from a fork lands through it too.

## Plan

Decided 2026-10-26 (user): the repository adopts its own gate first.

[moq-dev/quest#236](https://github.com/moq-dev/quest/pull/236) added the
Land workflow, a test that only its land job uses the `land` environment, and
`CONTRIBUTING.md`'s landing rule. The setup was finished on 2026-10-29; what
remains is the live verification and one credential restriction.

- **Push credential (user, 2026-10-29).** The repository moved from the
  kixelated account to the moq-dev organization, where moq-bot is installed
  on every repository, so moq-bot replaces the planned single-repository App.
  moq-bot was granted Workflows write on 2026-10-29, which lets it land PRs
  that change `.github/workflows`. The land job reads its key as `APP_CLIENT_ID` and `APP_PRIVATE_KEY`, today
  organization secrets that every moq-dev workflow can read. Open (user):
  restrict them to protected environments, such as `land` here and `publish`
  in moq-dev/moq, so a pushed branch's workflow cannot mint a token that
  bypasses `main`. The same names in the environment keep the workflow as is.
- **Ruleset (done 2026-10-29).** `main`'s ruleset blocks deletion and non-fast-forward
  pushes and requires two checks: `check` from GitHub Actions, and
  `quest land` pinned to moq-bot, which has no checks or statuses
  permission and so never reports it. Its bypass actors are moq-bot and
  the admin role, which keeps an emergency bypass. It replaced the classic
  protection that required `check`.
- **Forks (user, 2026-10-27).** The fork path was never verified live. This
  quest is done only once a fork PR that allows maintainer edits lands
  through the gate and shows as merged; any fix it needs lands here. GitHub
  offers maintainer edits only on forks a user owns, not an organization.
- The PR that finishes this quest lands through the gate, verifying the
  same-repository path.
