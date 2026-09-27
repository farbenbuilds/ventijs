import { defineConfig } from "tsdown";

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
export default defineConfig({
  dts: {
    generator: "tsgo",
  },
  exports: true,
  format: ["esm", "cjs"],
  platform: "node",
  copy: ["zig-out/lib/ventijs.node"],
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
