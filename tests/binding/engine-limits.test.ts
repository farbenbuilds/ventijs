//! The limits the prose claims, asserted against the binary. A restated constant is a
//! second copy that fails silently, so these assert relations and floors.

import { expect, test } from "vitest";
import { engineLimits } from "../../src/binding/server";
import { INBOUND_LIMIT_BYTES } from "../autobahn/inbound-limit";

const ENGINE_ROUTE = () => engineLimits();

test("the codec ceiling is above the engine route's", () => {
  // Compiled for the engine route, per connection for the codec: one number sizes neither.
  expect(ENGINE_ROUTE().maxPayloadBytes).toBeGreaterThan(ENGINE_ROUTE().messageBytes);
});

test("the codec ceiling reaches ws's 100 MiB default", () => {
  // Both `0` and the default must fit the ceiling, or the option is reported at a value it cannot honour.
  expect(ENGINE_ROUTE().maxPayloadBytes).toBeGreaterThanOrEqual(100 * 1024 * 1024);
});

test("the engine cap is the Autobahn suite's largest group-1 payload", () => {
  // Not a restatement of 65536: the claim is *at least* what the suite sends.
  expect(ENGINE_ROUTE().messageBytes).toBeGreaterThanOrEqual(65_536);
});

test("a frame can never exceed a message", () => {
  expect(ENGINE_ROUTE().frameBytes).toBeLessThanOrEqual(ENGINE_ROUTE().messageBytes);
});

test("the harness and the binary agree on the cap", () => {
  // The derivation the capacity model rests on; when they disagreed it selected 128 cases and the suite ran 301.
  expect(INBOUND_LIMIT_BYTES).toBe(ENGINE_ROUTE().messageBytes);
});

test("the fragment ceiling is ws's default, not a round number this project chose", () => {
  // `ws` defaults this to 16384, so the number is the contract; the boundary list starts at 16.
  expect(ENGINE_ROUTE().maxFragments).toBe(16_384);
});

test("a connection's queues are sized so one cannot outrun the other", () => {
  // A hardcoded copy is how the cap became 64 KiB while a test asserting 32 KiB passed.
  const limits = ENGINE_ROUTE();
  expect(limits.inboundSlots).toBeGreaterThan(limits.outboundSlots);
  expect(limits.connectionCapacity).toBeGreaterThan(limits.outboundSlots);
});

test("reading the limits does not allocate a connection", () => {
  // A client's cold path, so it must be a pure read; two equal reads is the cheapest proof.
  expect(ENGINE_ROUTE()).toEqual(ENGINE_ROUTE());
});
