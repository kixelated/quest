# [XS] Tidy development tooling

## Goal

Dependency updates and installs stop producing avoidable noise:

- Dependabot stops proposing vitest majors that `@cloudflare/vitest-plugin`
  can't run yet.
- The development shell carries one wrangler version.
- `npm ci` runs without install-script warnings.

## Plan

Decided 2026-10-14, following #96:

- In `.github/dependabot.yml`, ignore semver-major updates for `vitest`. A
  maintainer bumps it once the plugin's peer range includes the new major.
  #96 grouped vitest 4→5 with plugin 1.3.6, which only supports vitest 4, and
  every Worker test failed to start.
- Remove `wrangler` from the flake's dev shell. Every npm script and the
  deploy steps use the npm-pinned copy, which is newer than the Nix one
  (4.151.0 vs 4.132.0).
- Approve the `esbuild` and `workerd` postinstall scripts in `package.json`'s
  `allowScripts`, using npm 11's `npm install-scripts approve`. Both scripts
  fetch or verify native binaries the toolchain needs.
- Bundled into one quest because each change is a line or two.
