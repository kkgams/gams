{
  description = "GAMS standalone Host development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          hostTools = with pkgs; [ rustc cargo cargo-tauri libiconv pkg-config python3 nodejs cacert gnumake ];
        in {
          default = pkgs.mkShell {
            name = "gams-host-dev";
            nativeBuildInputs = hostTools;
          };
        });
    };
}
