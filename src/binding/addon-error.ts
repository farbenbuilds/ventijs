/// The message a missing native addon produces.
///
/// Its own module because it is the one error a caller sees for an *install* problem
/// rather than a programming error, so it has to be actionable by whoever hits it --
/// which is usually not the person who wrote the application, and never the person who
/// published the package. That makes it worth a file of its own and worth a direct
/// test: `load.ts` reaches it through the filesystem, and a test that had to reproduce
/// a broken install to reach the message would not be a test of the message.

/// Where the caller should look next, given how far the search got.
///
/// `root` is the package root the search started from, or `undefined` when there was no
/// `package.json` above the addon at all -- which is a broken install rather than a
/// platform mismatch, and needs a different sentence.
export function missingAddonMessage(
  root: string | undefined,
  platform: string,
  arch: string,
): string {
  const target = `${platform}-${arch}`;
  if (root === undefined) {
    return (
      "ventijs: the package layout is broken -- there is no package.json above the " +
      `native addon, so the artifact for ${target} cannot be located. Reinstalling ` +
      "ventijs should restore it."
    );
  }
  return (
    `ventijs: no native addon for ${target} was found under ${root}. An install ships ` +
    `the addon for one platform, so a ${target} machine needs ventijs built for ${target}, ` +
    "which needs the Zig toolchain (zig 0.16.0). If you are working in a checkout, " +
    'the command is "pnpm build:binding".'
  );
}
