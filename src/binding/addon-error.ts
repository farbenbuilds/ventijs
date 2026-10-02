/// The messages a caller reads when the native addon is not usable. They are the only
/// error a caller sees for an *install* problem, so they have to be actionable by
/// whoever hits it, which is usually neither the application's author nor the publisher.
import type { RuntimeName } from "./runtime";
import type { AddonTarget } from "./target";

/// Deno loads addons only from a local `node_modules` behind an FFI permission and Bun
/// goes through `bun install`, so a Node-only sentence sends those readers to a fix that
/// does not apply.
function runtimeHint(runtime: RuntimeName): string {
  if (runtime === "deno")
    return " Deno loads native addons only from a local node_modules and the load needs --allow-ffi and --allow-read.";
  if (runtime === "bun") return " Bun installs the optional binding with bun install.";
  return "";
}

/// Distinct from a missing one: the artifact exists, so this is a toolchain or libc
/// change rather than a platform mismatch, and the loader's own error is the whole
/// diagnosis, which is why it is kept as `cause`.
export function unloadableAddonMessage(
  path: string,
  platform: string,
  arch: string,
  runtime: RuntimeName = "node",
): string {
  return (
    `ventiws: the native addon at ${path} was found but could not be loaded, so it was ` +
    `built for a different ${platform}-${arch} or against a different libc. In a checkout ` +
    'the fix is "pnpm build:binding"; in an install, a package built for this platform. ' +
    "The loader's own error is the cause." +
    runtimeHint(runtime)
  );
}

/// `target` is `undefined` when the host is not a platform a published ventiws ships a
/// binary for, which is the common case on a locked-down host: the package installed
/// cleanly, every optional dependency was skipped, and there is nothing to load. The
/// published list is the useful part of that message, because the fix is a build rather
/// than a reinstall.
export function missingAddonMessage(
  root: string | undefined,
  platform: string,
  arch: string,
  target: AddonTarget | undefined,
  published: readonly AddonTarget[],
  runtime: RuntimeName = "node",
): string {
  const host = `${platform}-${arch}`;
  if (root === undefined) {
    return (
      "ventiws: the package layout is broken -- there is no package.json above the " +
      `native addon, so the artifact for ${host} cannot be located. Reinstalling ` +
      "ventiws should restore it." +
      runtimeHint(runtime)
    );
  }
  if (target === undefined) {
    return (
      `ventiws: no published native addon for ${host}, so nothing was installed to load. ` +
      `A published ventiws ships a binary for ${published.join(", ")}. In a checkout, ` +
      'the fix is "pnpm build:binding", which builds the addon for this machine.' +
      runtimeHint(runtime)
    );
  }
  return (
    `ventiws: the native addon for ${target} is not installed under ${root}. It is an ` +
    `optional dependency, so npm skipped it for ${host}; an install that resolves no ` +
    "binary for this host needs a reinstall, and a checkout needs " +
    '"pnpm build:binding".' +
    runtimeHint(runtime)
  );
}
