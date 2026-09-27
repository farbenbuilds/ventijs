import { expect, test } from "vitest";
import { loadAddon } from "../../src/binding/load";
import { engineLimits } from "../../src/binding/server";

test("loads the native addon", () => {
  expect(typeof loadAddon().engineVersion).toBe("function");
});

test("reports the pinned uWebZockets release", () => {
  expect(loadAddon().engineVersion()).toBe("1.7.0");
});

test("reports HTTP/3 support from the linked engine", () => {
  expect(loadAddon().http3Available()).toBe(true);
});

test("exposes the server lifecycle surface", () => {
  const addon = loadAddon();
  expect(typeof addon.createServer).toBe("function");
  expect(typeof addon.listenServer).toBe("function");
  expect(typeof addon.closeServer).toBe("function");
  expect(typeof addon.finalizeServer).toBe("function");
});

test("exposes the per-connection socket surface", () => {
  const addon = loadAddon();
  expect(typeof addon.sendSocket).toBe("function");
  expect(typeof addon.closeSocket).toBe("function");
  expect(typeof addon.pauseSocket).toBe("function");
  expect(typeof addon.resumeSocket).toBe("function");
  expect(typeof addon.socketBufferedAmount).toBe("function");
  expect(typeof addon.serverDroppedEvents).toBe("function");
});

/// `capacities.zig` calls each of these "a promise the compatibility layer has to
/// keep", and the promise is only checkable if the build reports what it compiled.
/// A restated TypeScript copy is a second source of truth, and that is how the
/// message cap came to be 64 KiB in the engine while a test still asserted
/// 32 KiB and passed.
test("the addon reports the capacities it was compiled with", () => {
  const limits = engineLimits();
  expect(limits.connectionCapacity).toBeGreaterThan(0);
  expect(limits.messageBytes).toBeGreaterThan(0);
  // A frame can never exceed a message, so the frame cap tracks it.
  expect(limits.frameBytes).toBeLessThanOrEqual(limits.messageBytes);
  expect(limits.inboundSlots).toBeGreaterThan(limits.outboundSlots);
});

/// RFC 6455 section 5.5 caps a control frame at 125 bytes, so the frame cap has
/// to admit one whatever the message cap is.
test("the frame cap admits a maximum control frame", () => {
  expect(engineLimits().frameBytes).toBeGreaterThanOrEqual(125);
});
