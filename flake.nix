{
  description = "Quest - versioned plans for repository work";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    # The pinned nixpkgs no longer evaluates on x86_64-darwin; Intel Macs use the release binary.
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ]
      (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            # Claude Code is unfree; the runner package pins it so adapters run a tested version.
            config.allowUnfreePredicate = pkg: nixpkgs.lib.getName pkg == "claude-code";
          };
          quest = pkgs.callPackage ./nix/package.nix { };
          # `quest runner` with the agent CLIs it drives pinned by this flake's lock.
          runner = pkgs.symlinkJoin {
            name = "quest-runner-${quest.version}";
            paths = [ quest ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/quest --set-default QUEST_RUNNER_CLAUDE ${pkgs.lib.getExe pkgs.claude-code}
            '';
            meta = quest.meta;
          };
          # package.json's packageManager pins Bun for CI runners without Nix.
          bunVersion = pkgs.lib.removePrefix "bun@" (pkgs.lib.importJSON ./package.json).packageManager;
        in
        {
          packages = {
            inherit quest runner;
            default = quest;
          };
          apps.default = flake-utils.lib.mkApp { drv = quest; };
          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              # Installs dependencies, runs every script and tool, and compiles the release binaries.
              bun
              just
              jq
              git
              gh
              direnv
              actionlint
              shellcheck
              shfmt
              nixfmt
            ];
          };
          formatter = pkgs.nixfmt;
          checks = {
            package = quest;
            bun-version = pkgs.runCommand "bun-version" { } ''
              if [ "${pkgs.bun.version}" != "${bunVersion}" ]; then
                echo "package.json pins bun@${bunVersion}, but the flake provides Bun ${pkgs.bun.version}" >&2
                exit 1
              fi
              touch "$out"
            '';
            quest-tree = pkgs.runCommand "quest-tree" { nativeBuildInputs = [ quest ]; } ''
              quest --root ${self} check
              touch "$out"
            '';
          };
        }
      );
}
