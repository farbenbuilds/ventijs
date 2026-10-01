// The transition table, away from the files it is written to: a directive in, the next
// version out. The three version sources and the workflow are held by `version.test.ts`.

import { expect, test } from "vitest";
import { compareVersions, nextVersion, releaseVersion } from "../../scripts/next-version.mjs";

test("a release directive moves the version the way its kinds say", () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ["1.0.0-alpha.12", [], "1.0.0-alpha.13"],
    ["1.0.0-alpha.12", ["beta"], "1.0.0-beta.0"],
    ["1.0.0-alpha", [], "1.0.0-alpha.1"],
    ["1.0.0-beta.3", ["beta"], "1.0.0-beta.4"],
    ["1.0.0-beta.3", ["stable"], "1.0.0"],
    ["2.0.0-rc.1", [], "2.0.0-rc.2"],
    ["1.0.0", [], "1.0.1-alpha.0"],
    ["1.0.0", ["beta"], "1.0.1-beta.0"],
    ["1.0.0", ["patch"], "1.0.1"],
    ["1.0.0", ["minor"], "1.1.0"],
    ["1.0.0", ["major"], "2.0.0"],
    ["1.0.0", ["major", "beta"], "2.0.0-beta.0"],
    ["1.0.1-alpha.2", ["major"], "2.0.0-alpha.0"],
    ["1.0.1-alpha.2", ["minor", "stable"], "1.1.0"],
  ];
  for (const [current, kinds, expected] of cases)
    expect(nextVersion(current, kinds), `${current} ${kinds}`).toBe(expected);
});

test("a directive that contradicts itself or the tree is refused", () => {
  expect(() => nextVersion("1.0.0", ["stable"])).toThrow("already stable");
  expect(() => nextVersion("1.0.0", ["major", "minor"])).toThrow("cannot combine");
  expect(() => nextVersion("1.0.0", ["alpha", "beta"])).toThrow("cannot combine");
  expect(() => nextVersion("1.0.0", ["nope"])).toThrow("unknown release kind");
});

test("an untagged tree version is released as written", () => {
  // The regression this holds: an authored `1.0.0-beta` advanced to `1.0.0-beta.1`
  // before it had ever been published.
  expect(releaseVersion("1.0.0-beta", [], false)).toBe("1.0.0-beta");
  expect(releaseVersion("1.0.0-beta", ["beta"], false)).toBe("1.0.0-beta");
  expect(releaseVersion("1.0.0-rc", ["rc"], false)).toBe("1.0.0-rc");
  expect(releaseVersion("1.0.0", [], false)).toBe("1.0.0");
  expect(releaseVersion("2.0.0", [], false)).toBe("2.0.0");
});

test("a version that already shipped advances by the directive", () => {
  expect(releaseVersion("1.0.0-beta", [], true)).toBe("1.0.0-beta.1");
  expect(releaseVersion("1.0.0-beta", ["stable"], true)).toBe("1.0.0");
  expect(releaseVersion("1.0.0", ["major"], true)).toBe("2.0.0");
  expect(releaseVersion("1.0.0", ["minor", "beta"], true)).toBe("1.1.0-beta.0");
});

test("a stable version is newer than its own prereleases", () => {
  const newer: ReadonlyArray<readonly [string, string]> = [
    ["1.0.1-alpha.2", "1.0.1-alpha.1"],
    ["1.0.1-alpha.1", "1.0.1-alpha"],
    ["1.0.1-beta.0", "1.0.1-alpha.9"],
    ["1.0.1", "1.0.1-rc.4"],
    ["2.0.0-rc.0", "1.9.9"],
  ];
  for (const [a, b] of newer) {
    expect(compareVersions(a, b), `${a} > ${b}`).toBeGreaterThan(0);
    expect(compareVersions(b, a), `${b} < ${a}`).toBeLessThan(0);
  }
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
});
