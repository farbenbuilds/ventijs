{
  description = "ventiws / A NodeJS WebSocket wrapper for µWebZockets";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-parts.url = "github:hercules-ci/flake-parts";
    zig-overlay.url = "github:mitchellh/zig-overlay";
    zon2nix.url = "github:jcollie/zon2nix";
  };

  outputs = inputs @ {
    self,
    flake-parts,
    ...
  }:
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem = {
        pkgs,
        system,
        ...
      }: let
        lib = pkgs.lib;
        isLinux = pkgs.stdenv.hostPlatform.isLinux;
        pkgsMusl =
          if isLinux
          then pkgs.pkgsMusl
          else null;

        zig = inputs.zig-overlay.packages.${system}."0.16.0" or pkgs.zig;
        # zon2nix does not publish packages for every supported Darwin system.
        zon2nixPackage = (inputs.zon2nix.packages.${system} or {}).zon2nix or null;

        pnpm = pkgs.callPackage ./nix/pnpm.nix {};
        pnpmMusl =
          if isLinux
          then pkgsMusl.callPackage ./nix/pnpm.nix {}
          else null;

        hostPackages = [
          zig
          pkgs.zls
          pkgs.typescript
          pkgs.typescript-language-server
        ];

        mkDevShell = packagePkgs: pnpmPackage: let
          # Zig cannot detect the host glibc from inside the Nix store, so the
          # default target pins the libc version explicitly. uWebZockets reads
          # the same variable for its own build graph.
          hostPlatform = packagePkgs.stdenv.hostPlatform;
          zigTarget =
            if !hostPlatform.isLinux
            then null
            else if hostPlatform.isMusl
            then "${hostPlatform.parsed.cpu.name}-linux-musl"
            else "${hostPlatform.parsed.cpu.name}-linux-gnu.${packagePkgs.glibc.version}";
        in
          packagePkgs.mkShell (
            {
              packages =
                hostPackages
                ++ [
                  packagePkgs.nodejs
                  pnpmPackage
                ]
                ++ lib.optional (zon2nixPackage != null) zon2nixPackage;

              # The engine compiles BoringSSL, lsquic, libdeflate, and zlib with
              # `zig cc` and `zig c++` from pinned package dependencies, so the
              # shell needs no CMake, Ninja, Perl, patch, or system zlib.
            }
            // lib.optionalAttrs (zigTarget != null) {
              UWEBZOCKETS_DEFAULT_TARGET = zigTarget;
            }
          );
      in {
        formatter = pkgs.alejandra;

        devShells =
          {
            default = mkDevShell pkgs pnpm;
          }
          // lib.optionalAttrs isLinux {
            musl = mkDevShell pkgsMusl pnpmMusl;
          };

        checks.format =
          pkgs.runCommand "check-format" {
            nativeBuildInputs = [pkgs.alejandra];
          } ''
            alejandra --check $(find ${./.} -name '*.nix' ! -name '*.zon.nix')
            touch $out
          '';
      };
    };
}
