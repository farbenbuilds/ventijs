//! The claims the documentation makes about limits, asserted against the binary. A constant
//! restated in a test is a second copy that fails silently when the first moves, so these
//! assert *relations* and *floors* wherever a relation is what the prose actually claims.

import { expect, test } from "vitest";
import { engineLimits } from "../../src/binding/server";
import { INBOUND_LIMIT_BYTES } from "../autobahn/inbound-limit";

const ENGINE_ROUTE = () => engineLimits();

test("the codec ceiling is above the engine route's", () => {
  // The engine route is compiled and the codec route is per connection; assuming one number sizes a deployment against the wrong one.
  expect(ENGINE_ROUTE().maxPayloadBytes).toBeGreaterThan(ENGINE_ROUTE().messageBytes);
});

test("the codec ceiling reaches ws's 100 MiB default", () => {
  // `maxPayload: 0` and the default must both be answerable inside the ceiling, or the option is reported at a value it cannot honour.
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
  // The derivation the capacity model depends on: when the two disagreed, the model selected 128 cases and the suite ran 301.
  expect(INBOUND_LIMIT_BYTES).toBe(ENGINE_ROUTE().messageBytes);
});

test("the fragment ceiling is ws's default, not a round number this project chose", () => {
  // `ws` defaults `maxFragments` to 16384, so matching the number matches the contract; the boundary list starts at sixteen entries.
  expect(ENGINE_ROUTE().maxFragments).toBe(16_384);
});

test("a connection's queues are sized so one cannot outrun the other", () => {
  // A hardcoded copy of these numbers is how the cap came to be 64 KiB while a test asserted 32 KiB and passed.
  const limits = ENGINE_ROUTE();
  expect(limits.inboundSlots).toBeGreaterThan(limits.outboundSlots);
  expect(limits.connectionCapacity).toBeGreaterThan(limits.outboundSlots);
});

test("reading the limits does not allocate a connection", () => {
  // Called on a client's cold path, so it has to be a pure read; two equal reads is the cheapest way to say so.
  expect(ENGINE_ROUTE()).toEqual(ENGINE_ROUTE());
});
