//! Which option reads reach into the compiled addon, and which do not.
//!
//! Its own module because the property is a boundary, not a behaviour: `ts-test.yml`
//! runs this directory with the addon available, and the reason it has to is that
//! normalization reads a compiled ceiling. What matters is that it reads it *only* when
//! a value has to be compared against it, because a normalizer that loads a binary to
//! compute a default is a normalizer that cannot be exercised without one.
//!
//! Every case here runs with the addon's loader poisoned, so a read that should not happen
//! fails rather than passing because a binary happened to be present.

import { afterEach, expect, test, vi } from "vitest";
import type * as LoadModule from "../../../src/binding/load";

const load = vi.hoisted(() => ({ calls: 0, poison: false }));

vi.mock("../../../src/binding/load", async (importOriginal) => {
  const original = await importOriginal<typeof LoadModule>();
  return {
    ...original,
    loadAddon: (): unknown => {
      if (load.poison) load.calls += 1;
      return original.loadAddon();
    },
  };
});

afterEach(() => {
  load.calls = 0;
  load.poison = false;
});

test("defaults are computed without the addon", async () => {
  const { normalizeServerOptions } = await import("../../../src/compat/options/server");
  load.poison = true;
  const options = normalizeServerOptions({ noServer: true });
  // `ws`'s default, taken as a constant. It is below the codec's ceiling by
  // construction, so there is nothing to compare and nothing to read.
  expect(options.maxPayload).toBe(100 * 1024 * 1024);
  expect(options.maxFragments).toBe(16 * 1024);
  expect(load.calls).toBe(0);
});

test("client defaults are computed without the addon", async () => {
  const { normalizeClientOptions } = await import("../../../src/compat/options/client");
  load.poison = true;
  const options = normalizeClientOptions();
  expect(options.maxPayload).toBe(100 * 1024 * 1024);
  expect(load.calls).toBe(0);
});

test("a maxPayload of zero reads the ceiling, because zero means the ceiling", async () => {
  const { normalizeServerOptions } = await import("../../../src/compat/options/server");
  const { codecLimits } = await import("../../../src/binding/codec");
  load.poison = true;
  // `0` is not "no limit" here: `ws` guards its own checks with `> 0`, so zero has to
  // become the real ceiling rather than a value nothing can be compared against.
  expect(normalizeServerOptions({ noServer: true, maxPayload: 0 }).maxPayload).toBe(
    codecLimits().maxPayloadBytes,
  );
  expect(load.calls).toBeGreaterThan(0);
});

test("a maxPayload above the ceiling is refused by name", async () => {
  const { normalizeServerOptions } = await import("../../../src/compat/options/server");
  const { codecLimits } = await import("../../../src/binding/codec");
  // The message names the option and the range, so a caller can fix it without reading
  // the source. A native ordinal at the first connection would not have named anything.
  expect(() =>
    normalizeServerOptions({ noServer: true, maxPayload: codecLimits().maxPayloadBytes + 1 }),
  ).toThrow(/maxPayload option must be an integer in/);
});

test("a maxFragments above the ceiling is refused by name", async () => {
  const { normalizeClientOptions } = await import("../../../src/compat/options/client");
  const { codecLimits } = await import("../../../src/binding/codec");
  // `maxFragments` is documented and defaulted by `ws` and absent from `@types/ws`, so a
  // typed caller cannot set it without a cast. The cast is here rather than on the option
  // type because the option *is* honoured.
  const options = { maxFragments: codecLimits().maxFragments + 1 } as never;
  expect(() => normalizeClientOptions(options)).toThrow(
    /maxFragments option must be an integer in/,
  );
});

test("a non-integer or negative value is refused whatever the ceiling is", async () => {
  const { normalizeServerOptions } = await import("../../../src/compat/options/server");
  for (const value of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "1024", null]) {
    expect(() => normalizeServerOptions({ noServer: true, maxPayload: value as never })).toThrow(
      /maxPayload option must be an integer in/,
    );
  }
});
