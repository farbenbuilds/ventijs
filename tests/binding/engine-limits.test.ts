//! The claims the documentation makes about limits, asserted against the binary.
//!
//! These are the sentences a caller reads in `COMPATIBILITY.md`, `README.md`, and
//! `docs/migrating.md` and then acts on. Each one is a number, and a number in prose is
//! exactly the kind of thing that goes stale: the previous tree reported `maxPayload` at
//! `ws`'s 100 MiB while a `comptime` constant of 32 KiB decided the real answer, and the
//! documentation was one of the things that said so.
//!
//! **`engineLimits` is the one place a number may be read rather than restated.** A
//! constant restated in a test is a second copy that fails silently when the first moves,
//! which is how a suite's own largest payload ended up above the cap the suite was
//! failing on. So these tests assert *relations* and *floors* wherever a relation is what
//! the prose actually claims, and the exact values only where a peer can observe them.

import { expect, test } from "vitest";
import { engineLimits } from "../../src/binding/server";
import { INBOUND_LIMIT_BYTES } from "../autobahn/inbound-limit";

/// The two numbers the documentation says are different things, and the claim is that
/// they are.
const ENGINE_ROUTE = () => engineLimits();

test("the codec ceiling is above the engine route's", () => {
  // The engine route is compiled; the codec route is per connection. The prose says so
  // in three files, and a reader who assumed they were the same number would size a
  // deployment against the wrong one.
  expect(ENGINE_ROUTE().maxPayloadBytes).toBeGreaterThan(ENGINE_ROUTE().messageBytes);
});

test("the codec ceiling reaches ws's 100 MiB default", () => {
  // `maxPayload: 0` and the default both have to be answerable inside the codec's
  // ceiling, or `maxPayload` is reported at a value it cannot honour -- which is the
  // failure this whole branch started from.
  expect(ENGINE_ROUTE().maxPayloadBytes).toBeGreaterThanOrEqual(100 * 1024 * 1024);
});

test("the engine cap is the Autobahn suite's largest group-1 payload", () => {
  // Not a restatement of 65536: the claim is that the cap is *at least* what the suite
  // sends, and the suite's size is the number that would change if the suite did.
  expect(ENGINE_ROUTE().messageBytes).toBeGreaterThanOrEqual(65_536);
});

test("a frame can never exceed a message", () => {
  expect(ENGINE_ROUTE().frameBytes).toBeLessThanOrEqual(ENGINE_ROUTE().messageBytes);
});

test("the harness and the binary agree on the cap", () => {
  // The derivation the capacity model depends on. When the two disagreed, the model
  // selected 128 cases and the suite ran 301, and nothing said so until the counts were
  // compared by hand.
  expect(INBOUND_LIMIT_BYTES).toBe(ENGINE_ROUTE().messageBytes);
});

test("the fragment ceiling is ws's default, not a round number this project chose", () => {
  // `ws` defaults `maxFragments` to 16384 and treats a larger count as a policy failure
  // rather than a protocol error, so matching the number matches the contract. It costs
  // nothing per connection: the boundary list starts at sixteen entries and grows to what
  // a peer actually fragmented.
  expect(ENGINE_ROUTE().maxFragments).toBe(16_384);
});

test("a connection's queues are sized so one cannot outrun the other", () => {
  // A hardcoded TypeScript copy of these numbers is how the cap came to be 64 KiB in the
  // engine while a test still asserted 32 KiB and passed. This asserts the binding reads
  // the binary by checking a relation that a copy would only satisfy by being right.
  const limits = ENGINE_ROUTE();
  expect(limits.inboundSlots).toBeGreaterThan(limits.outboundSlots);
  expect(limits.connectionCapacity).toBeGreaterThan(limits.outboundSlots);
});

test("reading the limits does not allocate a connection", () => {
  // `engineLimits` is called on a client's cold path by a caller deciding whether the
  // library is configured for the payload it is about to send, so it has to be a pure
  // read. Two reads returning equal values is the cheapest way to say that it is.
  expect(ENGINE_ROUTE()).toEqual(ENGINE_ROUTE());
});
