/// Two ways a comment budget can be wrong: it flags a file that is fine, which trains
/// everyone to ignore it, and it misses a file that is not. Both are decided here.

import { expect, test } from "vitest";
import { commentViolations } from "../../scripts/comment-budget.mjs";

function violationsOf(source: string, name = "sample.ts"): string[] {
  const violations: string[] = [];
  commentViolations(name, source, violations);
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

test("Zig's //! module doc is flagged in TypeScript", () => {
  expect(violationsOf(`//! module essay\n${burst(60, 0)}`)[0]).toContain("//!");
});

test("a run of comment lines is capped", () => {
  // Twelve consecutive comment lines, then enough code that the density budget is not
  // what fires: this test is about adjacency, and both firing at once would not say which.
  const source = [
    ...Array.from({ length: 12 }, (_, i) => `// ${i}`),
    ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`),
  ].join("\n");
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
  // Nine code lines and 18 comment lines is a ratio of 2.0, which a module of declarations
  // cannot avoid, so a band judges it: the floor is a module doc, the ceiling stops an essay.
  expect(violationsOf(burst(9, 0))).toEqual([]);
  expect(violationsOf(burst(9, 1))[0]).toContain("-code-line file exceeds");
  expect(violationsOf(burst(9, 2))[0]).toContain("-code-line file exceeds");
});

test("a small file still gets a module doc", () => {
  // Two declarations and a five-line module doc. The floor exists for this, because the
  // density ratio would allow one comment line and the file would have to be unreadable.
  const source = [
    "// one",
    "// two",
    "// three",
    "// four",
    "// five",
    "const a = 1;",
    "const b = 2;",
  ].join("\n");
  expect(violationsOf(source)).toEqual([]);
});

test("a Zig capacity table is judged by shape, not by ratio", () => {
  // Every code line declares a constant and every constant has one line of reason. That
  // is the rule's own example of a comment worth having, and a ratio would push a
  // capacity's explanation out rather than the prose around it.
  const table = Array.from({ length: 7 }, (_, i) => [
    `/// capacity ${i} and why`,
    `pub const c${i} = ${i};`,
  ])
    .flat()
    .join("\n");
  expect(violationsOf(table, "capacities.zig")).toEqual([]);
  expect(violationsOf("/// one\npub const a = 1;", "capacities.zig")).toEqual([]);
  const mixed = [
    "/// why",
    "pub const a = 1;",
    "/// what it does",
    "pub fn f() void {}",
    ...Array.from({ length: 6 }, (_, i) => `/// more ${i}`),
  ].join("\n");
  expect(violationsOf(mixed, "capacities.zig").length).toBeGreaterThan(0);
  expect(violationsOf(table, "table.ts").length).toBeGreaterThan(0);
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
  // The 30 commented lines are also 30 consecutive, so the run budget fires as well; the
  // assertion names the ratio message so it cannot pass on the run check having fired.
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
  // Eight one-line comments, each separated by a blank line, then the code. Adjacent
  // would be a run of eight and fail, which is the point.
  const spaced = [
    ...Array.from({ length: 8 }, (_, i) => `// ${i}\n`),
    ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`),
  ].join("\n");
  expect(violationsOf(spaced)).toEqual([]);
});
