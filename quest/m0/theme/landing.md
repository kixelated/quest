# [M] Build the landing page

## Goal

Signed-out visitors to the Worker's root see the logo and the hook ("a quest
log for your repo and your agents"), the substance lines, and then Quest's own
quest tree rendered live from the board as proof. Calls to action ("Accept the
quest") lead to sign-in, onboarding a GitHub repository, and the one-line SETUP
paste.

## Plan

- Decided over a static pitch or a repository directory: the live board of
  Quest's own tree is the most convincing demo of the product.
- Same dark look as the board, from `docs/theme.md`. Reuse the board's
  components rather than restyling them.
- Quest's own repository reaches Artifacts through GitHub sync.

## Required

- [Identity](/quest/m0/theme/identity.md) - the logo, palette, and voice
- [Quest board](/quest/m0/cloudflare/board.md) - the live tree the page embeds
- [GitHub sync](/quest/m0/cloudflare/github-sync.md) - mirrors Quest's own repository into Artifacts
