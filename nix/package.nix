# The `quest` CLI built from source: the same esbuild bundle `npm run build`
# makes, run by Node.
{
  lib,
  stdenv,
  nodejs,
  esbuild,
  importNpmLock,
}:
let
  manifest = lib.importJSON ../package.json;
  lock = lib.importJSON ../package-lock.json;
  packages = lock.packages;

  # The lockfile also covers the Worker and the test tooling, which the CLI
  # bundle never touches. Keep only the entries its runtime dependencies reach,
  # resolved the way Node does: the nearest enclosing node_modules wins.
  resolve =
    from: name:
    let
      scopes = if from == "" then [ ] else lib.splitString "/node_modules/" from;
      nested = lib.genList (
        i: lib.concatStringsSep "/node_modules/" (lib.take (lib.length scopes - i) scopes ++ [ name ])
      ) (lib.length scopes);
    in
    lib.findFirst (key: packages ? ${key}) null (nested ++ [ "node_modules/${name}" ]);
  reach = from: deps: lib.filter (key: key != null) (map (resolve from) (lib.attrNames deps));
  closure = builtins.genericClosure {
    startSet = map (key: { inherit key; }) (reach "" manifest.dependencies);
    operator =
      { key }:
      map (key: { inherit key; }) (
        reach key (packages.${key}.dependencies or { } // packages.${key}.peerDependencies or { })
      );
  };
  runtime = {
    inherit (manifest) name version dependencies;
  };
in
stdenv.mkDerivation {
  pname = manifest.name;
  inherit (manifest) version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../tsconfig.json
      ../src
      ../assets
    ];
  };

  npmDeps = importNpmLock {
    package = runtime;
    packageLock = lock // {
      packages = {
        "" = runtime;
      }
      // lib.listToAttrs (map ({ key }: lib.nameValuePair key packages.${key}) closure);
    };
  };

  # esbuild comes from nixpkgs rather than the lockfile's per-platform binaries.
  nativeBuildInputs = [
    nodejs
    esbuild
    importNpmLock.npmConfigHook
  ];
  # The bundle's `#!/usr/bin/env node` is patched to this Node.
  buildInputs = [ nodejs ];

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 dist/quest.js $out/bin/quest
    runHook postInstall
  '';

  meta = {
    inherit (manifest) description;
    homepage = "https://github.com/kixelated/quest";
    license = with lib.licenses; [
      mit
      asl20
    ];
    mainProgram = "quest";
  };
}
