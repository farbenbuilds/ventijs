// The libc answer decides which Linux package a host resolves: Deno states it in its
// build info, Node and Bun state it in the diagnostic report, and the probes catch the
// hosts that state nothing. Only the Deno arm can be forced under this test runner.

import { afterEach, expect, test, vi } from "vitest";
import { hostLibc } from "../../src/binding/host-libc";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.skipIf(process.platform !== "linux")("Deno's build ABI answers the libc question", () => {
  vi.stubGlobal("Deno", { build: { target: "x86_64-unknown-linux-musl" } });
  expect(hostLibc()).toBe("musl");
  vi.stubGlobal("Deno", { build: { env: "gnu" } });
  expect(hostLibc()).toBe("gnu");
});

test.skipIf(process.platform !== "linux")("a Deno build naming neither libc falls through", () => {
  // A non-Linux marker must not be mistaken for an answer; the probes still decide.
  vi.stubGlobal("Deno", { build: { env: "", target: "x86_64-pc-windows-msvc" } });
  expect(["gnu", "musl"]).toContain(hostLibc());
});
