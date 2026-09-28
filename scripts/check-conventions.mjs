#!/usr/bin/env node
// Enforces the mechanically checkable conventions that the other gates cannot:
// the 150-line module budget, the comment budget, snake_case Zig functions,
// kebab-case TypeScript filenames, and emoji code points. Scans `src/` and
// `tests/`; vendored and generated trees are out of scope. The comment budget has
// its own module because it is the only check that reads a file as more than a
// list of lines.

import { commentViolations } from "./comment-budget.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_ROOTS = ["src", "tests"];
const EXEMPT = new Set(["src/types/ws.d.ts"]);

// Generated output that lands inside a scanned root. The Autobahn harness writes its
// report and summary under `tests/autobahn/reports/`, which is gitignored, and a
// generated summary is a thousand lines of prose about a run rather than source. The
// scanner walks the filesystem rather than the index, so without this a suite run
// leaves a file that fails the line budget on the next `pnpm lint`.
const GENERATED_ROOTS = ["tests/autobahn/reports/"];
const MAX_LINES = 150;
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".zig",
  ".md",
  ".json",
  ".yml",
  ".yaml",
]);
const EMOJI = /\p{Extended_Pictographic}|\u20E3|\p{Regional_Indicator}/u;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ZIG_FUNCTION = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
// snake_case is lowercase words joined by single underscores; a leading,
// trailing, or doubled underscore is not snake_case.
const ZIG_SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    check(path);
  }
}

function check(path) {
  const name = relative(ROOT, path);
  if (EXEMPT.has(name)) return;
  if (GENERATED_ROOTS.some((root) => name.startsWith(root))) return;
  const extension = name.slice(name.lastIndexOf("."));
  if (!TEXT_EXTENSIONS.has(extension)) return;
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);

  if (lines > MAX_LINES) {
    violations.push(`${name}: ${lines} lines exceeds the ${MAX_LINES}-line module budget`);
  }

  commentViolations(name, source, violations);

  if (extension === ".zig") {
    for (const match of source.matchAll(ZIG_FUNCTION)) {
      if (!ZIG_SNAKE_CASE.test(match[1])) {
        violations.push(`${name}: Zig function '${match[1]}' is not snake_case`);
      }
    }
  }

  if (extension === ".ts" && name.startsWith("src/")) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const stem = base.slice(0, base.length - extension.length);
    if (!KEBAB_CASE.test(stem)) {
      violations.push(`${name}: TypeScript filename '${stem}' is not kebab-case`);
    }
  }

  if (EMOJI.test(source)) {
    violations.push(`${name}: contains an emoji code point`);
  }
}

for (const root of SCAN_ROOTS) walk(join(ROOT, root));

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`conventions: ${violation}\n`);
  process.exit(1);
}
