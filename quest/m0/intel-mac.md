# [XS] Drop x86_64-darwin from the flake

## Goal

`flake.nix` lists only systems that the pinned nixpkgs can build, so
`nix flake check` and flake pins don't advertise Intel Macs. Intel Mac users
install with the shell installer or mise, which use the Bun-compiled
`x86_64-apple-darwin` release binary, and `SETUP.md` says so.

## Plan

Decided while planning on 2026-10-07, after the Compiled releases PR (#70)
found that nixpkgs-unstable has dropped `x86_64-darwin`, so the Nix dev shell
won't start on Intel macOS. Release binaries for Intel Macs are unaffected,
since #70 compiles every target on Linux.
