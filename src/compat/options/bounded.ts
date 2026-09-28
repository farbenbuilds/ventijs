/// The only option rules that reach into the build, where the rest of the normalizer is arithmetic.

import { DEFAULT_MAX_FRAGMENTS, DEFAULT_MAX_PAYLOAD, invalidOption } from "./shared";

/// The `maxPayload` a codec will enforce. It must be an integer within the ceiling, because that
/// number is now the *actual* limit; `ws` coerces both, which is the harder failure to diagnose.

// Zero means no limit in `ws`, which guards its length checks with `_maxPayload > 0`. The
// codec's representation of "no limit" is the largest value it can enforce, so zero becomes the ceiling.

// A thunk, not a number, because reading the ceiling loads the addon. It is reached only when
// the option was set, since `ws`'s default is below the ceiling by construction.
export function maxPayloadOf(source: unknown, ceiling: () => number): number {
  return boundedOption("maxPayload", source, DEFAULT_MAX_PAYLOAD, ceiling);
}

/// Same shape and the same zero-means-no-limit rule as `maxPayloadOf`; `ws` guards it with `_maxFragments > 0`.
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
