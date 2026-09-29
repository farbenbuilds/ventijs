/// The message a missing native addon produces. It is the one error a caller sees for
/// an *install* problem, so it has to be actionable by whoever hits it, which is usually
/// neither the application's author nor the package's publisher.

/// Distinct from a missing one: the artifact exists, so this is a toolchain or libc
/// change rather than a platform mismatch, and the loader's own error is the whole
/// diagnosis, which is why it is kept as `cause`.
export function unloadableAddonMessage(path: string, platform: string, arch: string): string {
  return (
    `ventiws: the native addon at ${path} was found but could not be loaded, so it was ` +
    `built for a different ${platform}-${arch} or against a different libc. In a checkout ` +
    'the fix is "pnpm build:binding"; in an install, a package built for this platform. ' +
    "The loader's own error is the cause."
  );
}

/// `root` is the package root the search started from, or `undefined` when there was no
/// `package.json` above the addon at all, which is a broken install rather than a
/// platform mismatch and needs a different sentence.
export function missingAddonMessage(
  root: string | undefined,
  platform: string,
  arch: string,
): string {
  const target = `${platform}-${arch}`;
  if (root === undefined) {
    return (
      "ventiws: the package layout is broken -- there is no package.json above the " +
      `native addon, so the artifact for ${target} cannot be located. Reinstalling ` +
      "ventiws should restore it."
    );
  }
  return (
    `ventiws: no native addon for ${target} was found under ${root}. An install ships ` +
    `the addon for one platform, so a ${target} machine needs ventiws built for ${target}, ` +
    "which needs the Zig toolchain (zig 0.16.0). If you are working in a checkout, " +
    'the command is "pnpm build:binding".'
  );
}
