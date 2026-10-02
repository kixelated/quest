# [M] Build the quest core for wasm

## Goal

The parsing, `check` rules, and `ready` logic build for wasm32 and run in
the Worker over files read from Artifacts. There is one implementation, so the
board and the CLI never disagree. CI builds and tests the wasm target.

## Plan

- Separate the pure core (documents in, findings and readiness out) from the
  git overlay and process calls, which stay native-only.
- Expose a small wasm-bindgen API that the Worker imports as a local package.
- Prefer refactoring the existing modules over adding a parallel API.
