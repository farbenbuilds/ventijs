import { expect, test } from "vitest";
import { codecLimits } from "../../../src/binding/codec";
import { normalizeServerOptions } from "../../../src/compat/options/server";

test("fills the ws server defaults", () => {
  const options = normalizeServerOptions({ noServer: true });
  expect(options.noServer).toBe(true);
  expect(options.clientTracking).toBe(true);
  expect(options.allowSynchronousEvents).toBe(true);
  expect(options.autoPong).toBe(true);
  expect(options.maxPayload).toBe(100 * 1024 * 1024);
  expect(options.skipUTF8Validation).toBe(false);
  expect(options.perMessageDeflate).toBe(false);
  expect(options.host).toBeNull();
  expect(options.path).toBeNull();
});

test("requires exactly one listen target", () => {
  expect(() => normalizeServerOptions()).toThrow(/One and only one/);
  expect(() => normalizeServerOptions({ port: 0, noServer: true })).toThrow(TypeError);
  expect(normalizeServerOptions({ port: 0 }).port).toBe(0);
});

test("preserves explicit falsy and zero server values", () => {
  const options = normalizeServerOptions({
    noServer: true,
    clientTracking: false,
    allowSynchronousEvents: false,
    autoPong: false,
    maxPayload: 0,
    skipUTF8Validation: true,
  });
  expect(options.clientTracking).toBe(false);
  expect(options.allowSynchronousEvents).toBe(false);
  expect(options.autoPong).toBe(false);
  // Zero is `ws`'s "no limit" rather than "refuse everything": it guards
  // `_maxPayload > 0`, so the check is disabled. The codec's representation of that
  // is the largest value it can enforce, so the normalized record carries the
  // ceiling and `engineLimits().maxPayloadBytes` is what makes it checkable.
  expect(options.maxPayload).toBe(codecLimits().maxPayloadBytes);
  expect(options.skipUTF8Validation).toBe(true);
});

test("normalizes per-message deflate to its ws defaults", () => {
  expect(normalizeServerOptions({ noServer: true, perMessageDeflate: true })).toMatchObject({
    perMessageDeflate: {
      serverNoContextTakeover: undefined,
      clientNoContextTakeover: undefined,
      serverMaxWindowBits: undefined,
      clientMaxWindowBits: undefined,
      threshold: 1024,
      concurrencyLimit: 10,
      zlibDeflateOptions: undefined,
      zlibInflateOptions: undefined,
    },
  });
});

test("keeps explicit per-message deflate settings", () => {
  const options = normalizeServerOptions({
    noServer: true,
    perMessageDeflate: {
      threshold: 512,
      serverNoContextTakeover: false,
      serverMaxWindowBits: 10,
      clientMaxWindowBits: 12,
    },
  });
  expect(options.perMessageDeflate).toEqual({
    serverNoContextTakeover: false,
    clientNoContextTakeover: undefined,
    serverMaxWindowBits: 10,
    clientMaxWindowBits: 12,
    threshold: 512,
    concurrencyLimit: 10,
    zlibDeflateOptions: undefined,
    zlibInflateOptions: undefined,
  });
});

test("ignores inherited option properties the way ws does", () => {
  const polluted = Object.create({ port: 8080 }) as { noServer?: boolean };
  polluted.noServer = true;
  const options = normalizeServerOptions(polluted);
  expect(options.noServer).toBe(true);
  expect(options.port).toBeNull();
});

test("evaluates each option getter exactly once", () => {
  let reads = 0;
  const source = {
    noServer: true,
    get maxPayload(): number {
      reads += 1;
      return 1024;
    },
  };
  const options = normalizeServerOptions(source);
  expect(options.maxPayload).toBe(1024);
  expect(reads).toBe(1);
});

test("treats a falsy server as absent, matching ws", () => {
  expect(() => normalizeServerOptions({ server: 0 as never })).toThrow(/One and only one/);
  expect(normalizeServerOptions({ server: 0 as never, port: 0 }).port).toBe(0);
  expect(normalizeServerOptions({ server: 0 as never, noServer: true }).noServer).toBe(true);
});

test("a falsy per-message deflate value disables the extension", () => {
  expect(
    normalizeServerOptions({ noServer: true, perMessageDeflate: null as never }).perMessageDeflate,
  ).toBe(false);
});
