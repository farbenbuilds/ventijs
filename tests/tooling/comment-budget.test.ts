/// The comment budget's own test, because a gate that is wrong is worse than no gate.
///
/// Two ways it can be wrong: it flags a file that is fine, which trains everyone to
/// ignore it, and it misses a file that is not, which is the case it exists for. Both
/// are decided here rather than discovered on someone's next change.

import { expect, test } from "vitest";
import { commentViolations } from "../../scripts/comment-budget.mjs";

function violationsOf(source: string): string[] {
  const violations: string[] = [];
  commentViolations("sample.ts", source, violations);
  return violations;
}

/// A file comfortably inside both budgets, to prove the check is not simply noisy: 19
/// code lines and one comment line is ordinary, well-commented code.
const CLEAN = [
  "// One reason.",
  "let a = 1;",
  ...Array.from({ length: 18 }, (_, i) => `let v${i} = ${i};`),
].join("\n");

test("a file inside the budget is not flagged", () => {
  expect(violationsOf(CLEAN)).toEqual([]);
});

test("a run of comment lines is capped", () => {
  const source = [...Array.from({ length: 12 }, (_, i) => `// ${i}`), "let a = 1;"].join("\n");
  expect(violationsOf(source)).toHaveLength(1);
  expect(violationsOf(source)[0]).toContain("consecutive comment lines");
});

test("a file commented uniformly past the ratio is flagged", () => {
  // Every other line a comment: 21 comment lines for 20 code lines, and no two comments
  // adjacent. The run cap does not catch this, which is why there are two numbers.
  const source = Array.from({ length: 41 }, (_, i) =>
    i % 2 === 0 ? `// c${i}` : `let v${i} = 1;`,
  ).join("\n");
  expect(violationsOf(source).some((v) => v.includes("comment lines for"))).toBe(true);
});

test("a declaration table is exempt from the ratio", () => {
  // Nine code lines of compiled constants and eighteen comment lines: the comments are
  // the reason the file exists, and a ratio would forbid the file. Interleaved, so the
  // run cap is not what is under test here either.
  const source = Array.from({ length: 18 }, (_, i) =>
    i % 2 === 0 ? `// why ${i}` : `const c${i} = ${i};`,
  ).join("\n");
  expect(violationsOf(source)).toEqual([]);
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
