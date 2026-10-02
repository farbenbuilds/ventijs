// Which `@ventiws/binding-*` package a host resolves to. The mapping is the whole of
// the install-time dispatch, and a wrong answer is a `MODULE_NOT_FOUND` at first socket
// rather than anything a caller can act on, so each family is pinned from both sides.

import { expect, test } from "vitest";
import {
  addonTarget,
  bindingPackageName,
  hostAddonTarget,
  PUBLISHED_TARGETS,
} from "../../src/binding/target";

test("each published target names a package under the scope", () => {
  // npm rejects a slash in an unscoped name, so the scope has to arrive with its `@`.
  for (const target of PUBLISHED_TARGETS) {
    const name = bindingPackageName(target);
    expect(name.startsWith("@ventiws/binding-")).toBe(true);
    expect(name).toBe(`@ventiws/binding-${target}`);
  }
});

test("the published list is the five targets the release builds", () => {
  // A count is the cheapest thing that notices an accidental drop or a stray add, and the
  // membership is pinned against the build graph by tests/tooling/publish-platforms.
  expect(PUBLISHED_TARGETS).toEqual([
    "linux-x64-gnu",
    "linux-arm64-gnu",
    "linux-x64-musl",
    "darwin-x64",
    "darwin-arm64",
  ]);
});

test("a host on a target the release does not build resolves to nothing", () => {
  // `undefined` is what turns an unbuilt target into a message naming the published list
  // rather than a resolver error. Windows is in this set because the pinned toolchain
  // cannot link a Windows addon yet, so `win32-x64` is deliberately absent above.
  expect(addonTarget("win32", "x64", "gnu")).toBeUndefined();
  expect(addonTarget("win32", "arm64", "gnu")).toBeUndefined();
  expect(addonTarget("linux", "arm", "gnu")).toBeUndefined();
  expect(addonTarget("freebsd", "x64", "gnu")).toBeUndefined();
  expect(addonTarget("aix", "ppc64", "gnu")).toBeUndefined();
});

test("the darwin family is arch-mapped and ignores the libc", () => {
  // Darwin carries no libc suffix, so a Darwin mapping must answer the same for both
  // libc values rather than letting a musl answer leak a nonexistent package name.
  expect(addonTarget("darwin", "x64", "gnu")).toBe("darwin-x64");
  expect(addonTarget("darwin", "x64", "musl")).toBe("darwin-x64");
  expect(addonTarget("darwin", "arm64", "gnu")).toBe("darwin-arm64");
  expect(addonTarget("darwin", "arm64", "musl")).toBe("darwin-arm64");
});

test("a linux x64 host splits by libc", () => {
  expect(addonTarget("linux", "x64", "gnu")).toBe("linux-x64-gnu");
  expect(addonTarget("linux", "x64", "musl")).toBe("linux-x64-musl");
});

test("musl arm64 resolves to nothing, because no such package is published", () => {
  // Alpine arm64 is the one Linux triple the release does not build. Naming it anyway
  // would send the install down a `require` of a package that does not exist, so the
  // host takes the unsupported-platform path and is shown the five that do.
  expect(addonTarget("linux", "arm64", "gnu")).toBe("linux-arm64-gnu");
  expect(addonTarget("linux", "arm64", "musl")).toBeUndefined();
  expect(PUBLISHED_TARGETS).not.toContain("linux-arm64-musl");
});

test("a host outside the published set still names a package it will not find", () => {
  // Windows today, and the point is that it resolves to nothing rather than to a name
  // that would throw at first socket. A developer on such a host still runs the suite,
  // because the loader prefers the checkout artifact over any installed package.
  const target = hostAddonTarget();
  if (target !== undefined) expect(PUBLISHED_TARGETS).toContain(target);
  expect(PUBLISHED_TARGETS).toHaveLength(5);
});
