/// Two ways a comment budget can be wrong: it flags a file that is fine, which trains
/// everyone to ignore it, and it misses a file that is not. Both are decided here.

import { expect, test } from "vitest";
import { commentViolations } from "../../scripts/comment-budget.mjs";

function violationsOf(source: string): string[] {
  const violations: string[] = [];
  commentViolations("sample.ts", source, violations);
  return violations;
}

/// `code` code lines, each preceded by a burst of `per` comment lines. Bursts stay
/// under the run cap on purpose, so a test can exercise the ratio without also tripping
/// the run check and passing for the wrong reason.
function burst(code: number, per: number): string {
  const lines: string[] = [];
  for (let i = 0; i < code; i += 1) {
    for (let c = 0; c < per; c += 1) lines.push(`// why ${i}.${c}`);
    lines.push(`const v${i} = ${i};`);
  }
  return lines.join("\n");
}

test("a file inside the budget is not flagged", () => {
  expect(violationsOf(burst(60, 0))).toEqual([]);
  expect(violationsOf(`// one reason.\n${burst(60, 0)}`)).toEqual([]);
});

test("a run of comment lines is capped", () => {
  const source = [...Array.from({ length: 12 }, (_, i) => `// ${i}`), "let a = 1;"].join("\n");
  expect(violationsOf(source)).toHaveLength(1);
  expect(violationsOf(source)[0]).toContain("consecutive comment lines");
});

test("a file commented uniformly past the ratio is flagged", () => {
  const source = burst(60, 1);
  expect(violationsOf(source)).toHaveLength(1);
  expect(violationsOf(source)[0]).toContain("comment lines for");
});

test("a file inside the ratio is not flagged", () => {
  expect(violationsOf(burst(60, 0) + "\n")).toEqual([]);
  expect(
    violationsOf(
      Array.from({ length: 12 }, (_, i) => `// c${i}\nconst v${i} = ${i};`).join("\n") +
        Array.from({ length: 48 }, (_, i) => `const w${i} = ${i};`).join("\n"),
    ),
  ).toEqual([]);
});

test("a small file is capped in absolute terms, not by ratio", () => {
  // 9 code lines and 18 comment lines: a ratio of 2.0 that a documented six-function
  // module cannot avoid, so the absolute cap is what judges a file this size.
  expect(violationsOf(burst(9, 2))).toEqual([]);
  expect(violationsOf(burst(9, 3))[0]).toContain("-line file exceeds");
});

test("a block comment counts as a run", () => {
  const source = [
    "/**",
    ...Array.from({ length: 12 }, (_, i) => ` * line ${i}`),
    " */",
    "let a = 1;",
  ].join("\n");
  expect(violationsOf(source).some((v) => v.includes("consecutive comment lines"))).toBe(true);
});

test("a trailing comment is counted", () => {
  // 30 lines carrying a comment beside their code against 40 that do not. Counting only
  // lines that begin with a comment would score this file as clean.
  const source = [
    ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i}; // index ${i}`),
    ...Array.from({ length: 40 }, (_, i) => `const w${i} = ${i};`),
  ].join("\n");
  // The 30 commented lines are also 30 consecutive, so the run budget fires as well. The
  // assertion names the ratio message rather than counting, so it cannot pass on the run
  // check having fired first.
  expect(violationsOf(source).some((v) => v.includes("comment lines for"))).toBe(true);
});

test("a comment marker inside a string is not a comment", () => {
  // A glob written as "tests/autobahn/**" contains "/*" and a URL contains "//". Read as
  // text, either one opened a block comment that swallowed the rest of the file.
  const source = [
    'const GLOB = "tests/autobahn/**";',
    'const URL = "wss://example.invalid/ws";',
    ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`),
  ].join("\n");
  expect(violationsOf(source)).toEqual([]);
});

test("a blank line ends a run", () => {
  // Two items each carrying a doc comment are not one module essay, so the cap counts a
  // run of adjacency rather than a total.
  const spaced = Array.from({ length: 8 }, (_, i) => `// ${i}\n\n`).join("\n");
  expect(violationsOf(spaced)).toEqual([]);
});
