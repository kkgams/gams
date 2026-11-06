{
  description = "GAMS standalone Host development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      gameIconsPython = pkgs: pkgs.python3.withPackages (python: with python; [
        fonttools brotli uharfbuzz
      ]);
    in {
      # Optional asset compiler only: entering the shell or building the Host
      # never realizes this dependency tree or regenerates the checked-in font.
      packages = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          game-icons-tooling = pkgs.importNpmLock.buildNodeModules {
            npmRoot = ./scripts/game-icons;
            nodejs = pkgs.nodejs_24;
          };
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          hostTools = with pkgs; [ rustc cargo cargo-tauri cargo-about pkg-config (gameIconsPython pkgs) nodejs_24 cacert gnumake ];
          platformLibraries = with pkgs; lib.optionals stdenv.isDarwin [ libiconv ]
            ++ lib.optionals stdenv.isLinux [ glib gtk3 webkitgtk_4_1 libsoup_3 openssl ];
        in {
          default = pkgs.mkShell {
            name = "gams-host-dev";
            nativeBuildInputs = hostTools;
            buildInputs = platformLibraries;
          };
        });
    };
}
