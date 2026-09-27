/// The two options whose bound is a number only the compiled addon knows.
///
/// Split out of \`shared.ts\` because these are the only option rules that reach into the
/// build, and that is a different kind of rule from every other one here: the rest of the
/// normalizer is arithmetic on the caller's own object, and this reads a constant out of a
/// binary. Keeping them together would make "does this need a native addon" a question
/// about a file rather than about a function.

import { DEFAULT_MAX_FRAGMENTS, DEFAULT_MAX_PAYLOAD, invalidOption } from "./shared";

/// The `maxPayload` a codec will enforce, in bytes. and the reason is that this
/// number is now the *actual* limit: a codec's buffers are runtime-sized and bounded
/// by it, so `maxPayload: 1.5` would mean a ceiling nothing can be compared against
/// and a negative one would mean a server that closes every connection with 1009 on
/// the first byte. `ws` coerces both and closes the connection later, which is the
/// harder failure to diagnose.
///
/// The ceiling is the addon's, read from the compiled artifact rather than restated, so
/// a caller that asks for more than the build supports is refused by name here instead
/// of arriving as a native enum ordinal.
///
/// **A thunk, not a number**, because reading the ceiling loads the addon and this
/// function is otherwise pure. It is called only when the option was set, and only on the
/// path that has to compare against it: an absent option takes `ws`'s default, which is
/// below the ceiling by construction, and a value already in range needs no bound. A
/// caller that constructs a server and never sets `maxPayload` therefore never loads
/// native code from this function, which is what keeps option normalization testable
/// without a build.
export function maxPayloadOf(source: unknown, ceiling: () => number): number {
  return boundedOption("maxPayload", source, DEFAULT_MAX_PAYLOAD, ceiling);
}

/// The `maxFragments` a codec will enforce. Same shape and the same zero-means-no-limit
/// rule as `maxPayloadOf`; `ws` guards it with `_maxFragments > 0` for the same reason.
export function maxFragmentsOf(source: unknown, ceiling: () => number): number {
  return boundedOption("maxFragments", source, DEFAULT_MAX_FRAGMENTS, ceiling);
}

function boundedOption(
  name: string,
  source: unknown,
  fallback: number,
  readCeiling: () => number,
): number {
  const raw = (source as { readonly [key: string]: unknown })[name];
  if (raw === undefined) return fallback;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw === 0) {
    return readCeiling();
  }
  const ceiling = readCeiling();
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > ceiling) {
    invalidOption(
      `The ${name} option must be an integer in [0, ${ceiling}] (received ${String(raw)})`,
      RangeError,
    );
  }
  return raw;
}
