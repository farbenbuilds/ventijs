import { expect, test } from "vitest";
import { codecLimits } from "../../../src/binding/codec";
import { normalizeClientOptions } from "../../../src/compat/options/client";

test("fills the ws client defaults", () => {
  const options = normalizeClientOptions();
  expect(options.protocolVersion).toBe(13);
  expect(options.followRedirects).toBe(false);
  expect(options.maxRedirects).toBe(10);
  expect(options.maxPayload).toBe(100 * 1024 * 1024);
  expect(options.skipUTF8Validation).toBe(false);
  expect(options.headers).toBeUndefined();
});

test("rejects unsupported protocol versions like ws", () => {
  expect(() => normalizeClientOptions({ protocolVersion: 9 })).toThrow(RangeError);
  expect(normalizeClientOptions({ protocolVersion: 8 }).protocolVersion).toBe(8);
});

test("preserves explicit falsy and zero client values", () => {
  const options = normalizeClientOptions({
    followRedirects: true,
    maxRedirects: 0,
    maxPayload: 0,
    skipUTF8Validation: true,
    allowSynchronousEvents: false,
    autoPong: false,
    perMessageDeflate: false,
  });
  expect(options.followRedirects).toBe(true);
  expect(options.maxRedirects).toBe(0);
  // Zero is `ws`'s "no limit" rather than "refuse everything": it guards
  // `_maxPayload > 0`, so the check is disabled. The codec's representation of that
  // is the largest value it can enforce, so the normalized record carries the
  // ceiling and `engineLimits().maxPayloadBytes` is what makes it checkable.
  expect(options.maxPayload).toBe(codecLimits().maxPayloadBytes);
  expect(options.skipUTF8Validation).toBe(true);
  expect(options.allowSynchronousEvents).toBe(false);
  expect(options.autoPong).toBe(false);
  expect(options.perMessageDeflate).toBe(false);
});

test("fills the client per-message deflate defaults", () => {
  expect(normalizeClientOptions().perMessageDeflate).toEqual({
    serverNoContextTakeover: undefined,
    clientNoContextTakeover: undefined,
    serverMaxWindowBits: undefined,
    clientMaxWindowBits: undefined,
    threshold: 1024,
    concurrencyLimit: 10,
    zlibDeflateOptions: undefined,
    zlibInflateOptions: undefined,
  });
});

test("copies client headers instead of aliasing them", () => {
  const headers = { a: "1" };
  const options = normalizeClientOptions({ headers });
  expect(options.headers).toEqual({ a: "1" });
  expect(options.headers).not.toBe(headers);
  headers.a = "2";
  expect(options.headers).toEqual({ a: "1" });
});
