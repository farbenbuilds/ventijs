import { existsSync } from "node:fs";
import { defineConfig } from "tsdown";

/// A checkout copies the freshly built host artifact into `dist`, so `pnpm build` leaves
/// a tree that runs. A release build has no host artifact at all: the addon ships as the
/// `@ventiws/binding-*` package for the reader's platform, so the copy is skipped rather
/// than failing a build whose whole purpose is the platform packages.
const hostAddon = "zig-out/lib/ventiws.node";

/// The published shape.
///
/// Two formats, because a drop-in replacement for `ws` is consumed by both halves of
/// the Node ecosystem and an ESM-only package is not one. `ws` itself ships CJS with
/// an ESM wrapper, and a CommonJS TypeScript consumer with `moduleResolution: node16`
/// cannot even *compile* against an ESM-only dependency -- it fails with TS1479 and
/// TS1541 before a line runs, and there is nothing a caller can do about it from their
/// own `tsconfig`.
///
/// `exports: true` lets `tsdown` write the `exports` map from what it built, so the
/// map cannot name a file that is not there. It also rewrites `package.json` on every
/// build, including a build to a different output directory, which is why the
/// `outDir` below is not parameterised: a build whose `exports` depends on where it
/// wrote its output is a build that can produce a wrong map.
///
/// The repository's own sources import siblings with explicit `.ts` specifiers, which is
/// what Node's native type stripping needs at runtime and what `allowImportingTsExtensions`
/// in `tsconfig.json` permits. That is a repository-wide choice rather than a bundle
/// setting, and it has to be on for the two harnesses under `tests/autobahn/` and
/// `bench/`, which run `.ts` under plain `node` with no loader shim.
export default defineConfig({
  dts: {
    generator: "tsgo",
  },
  exports: true,
  format: ["esm", "cjs"],
  platform: "node",
  copy: existsSync(hostAddon) ? [hostAddon] : [],
  /// `ws` is `module.exports = WebSocket` with the rest hung off it, so
  /// `const WebSocket = require("ws")` gives the class. A bundler's CJS output is a
  /// namespace object instead, which makes that line a silent `undefined` rather than
  /// an error. The footer restores the shape for the one form a caller is most likely
  /// to paste from a `ws` example, and every named export stays reachable either way.
  footer: ({ format }) =>
    format === "cjs"
      ? {
          js: "module.exports = Object.assign(module.exports.default ?? module.exports, module.exports);",
        }
      : undefined,
});
