# [XS] Run the release binary checks on CLI pull requests

## Goal

A pull request that changes the CLI (`src/**`) runs the Release workflow's
build and native binary checks on all four runners before it merges. Today the
workflow's `pull_request.paths` skips `src/**`, so CLI changes reach the native
binaries only through the pre-tag dry run.

## Plan

Decided on 2026-10-07, after the EPIPE review (kixelated/quest#81). Add `src/**`
to `.github/workflows/release.yml`'s `pull_request.paths`. That costs four
native runs, two of them macOS, on CLI pull requests, which is accepted. It
doesn't block v0.1.0, since the tagging steps already dry-run the Release
workflow on main.
