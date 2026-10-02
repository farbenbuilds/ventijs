// The opener is selected per runtime, and the Deno branch is the one no Node test run
// can exercise for real: stubbing the global and the primitive is what keeps it covered.

import process from "node:process";
import { afterEach, expect, test, vi } from "vitest";
import { openAddon } from "../../src/binding/open";
import type { VentiAddon } from "../../src/binding/native";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function caughtCode(call: () => unknown): string | undefined {
  try {
    call();
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

test("a Deno host opens through process.dlopen", () => {
  vi.stubGlobal("Deno", { version: { deno: "2.8.0" }, build: { env: "gnu" } });
  const addon = { engineVersion: () => "stub" } as unknown as VentiAddon;
  const dlopen = vi.spyOn(process, "dlopen").mockImplementation((module) => {
    (module as { exports: VentiAddon }).exports = addon;
  });
  expect(openAddon("/opt/app/ventiws.node")).toBe(addon);
  expect(dlopen).toHaveBeenCalledWith(expect.anything(), "/opt/app/ventiws.node", 0);
});

test("a Node host opens through require, not process.dlopen", () => {
  // A missing path is enough: require fails MODULE_NOT_FOUND, where the Deno branch
  // would have reached the stubbed primitive first.
  const dlopen = vi.spyOn(process, "dlopen");
  expect(caughtCode(() => openAddon("/nonexistent/ventiws-test.node"))).toBe("MODULE_NOT_FOUND");
  expect(dlopen).not.toHaveBeenCalled();
});
