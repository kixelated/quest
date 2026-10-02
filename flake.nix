{
  description = "Quest - versioned plans for repository work";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      crane,
      rust-overlay,
      ...
    }:
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ]
      (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ (import rust-overlay) ];
          };
          toolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
          quest = craneLib.buildPackage {
            # The guide and skills are compiled in, and a test compares this
            # repository's installed stubs against them.
            src = pkgs.lib.cleanSourceWith {
              src = ./.;
              filter =
                path: type:
                craneLib.filterCargoSources path type
                || pkgs.lib.hasInfix "/assets" path
                || pkgs.lib.hasSuffix "/.claude" path
                || pkgs.lib.hasInfix "/.claude/skills" path;
            };
            strictDeps = true;
            # The line-branch readiness tests build real repositories.
            nativeCheckInputs = [ pkgs.git ];
          };
        in
        {
          packages = {
            inherit quest;
            default = quest;
          };
          apps.default = flake-utils.lib.mkApp { drv = quest; };
          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              toolchain
              just
              jq
              git
              gh
              direnv
              cargo-nextest
              wasm-bindgen-cli
              cargo-dist
              actionlint
              shellcheck
              shfmt
              taplo
              nixfmt
              nodejs_24
              wrangler
            ];
          };
          formatter = pkgs.nixfmt;
          checks = {
            package = quest;
            quest-tree = pkgs.runCommand "quest-tree" { nativeBuildInputs = [ quest ]; } ''
              quest --root ${self} check
              touch "$out"
            '';
          };
        }
      );
}
