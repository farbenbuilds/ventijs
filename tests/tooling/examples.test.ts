// The runtime examples teach one API on three runtimes, and the teaching file itself is the
// same `index.ts` in each. The Effect RPC example is a multi-file project: it is held to the
// same manifest properties, not to a shared entry point.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const EXAMPLES = ["vanilla", "bun", "deno", "effect-rpc"];
const SHARED = ["vanilla", "bun", "deno"];

type Manifest = {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const example = (runtime: string, file: string) => read(`examples/${runtime}-ventiws/${file}`);
const manifest = (runtime: string) => JSON.parse(example(runtime, "package.json")) as Manifest;

test("the runtime examples ship the same index.ts", () => {
  const sources = SHARED.map((runtime) => example(runtime, "index.ts"));
  expect(new Set(sources).size).toBe(1);
});

test("every example resolves ventiws from the registry, not the workspace", () => {
  // `workspace:`, `file:`, and `link:` specifiers would bind the examples to the checkout
  // instead of the published package the standalone-project claim rests on.
  for (const runtime of EXAMPLES) {
    expect(manifest(runtime).dependencies?.ventiws, runtime).toBe("latest");
  }
});

test("only the Node examples declare @types/node", () => {
  // Bun and Deno type their own APIs; a direct @types/node there would pin a second
  // Node surface beside the runtime's.
  const carriers = EXAMPLES.filter(
    (runtime) => manifest(runtime).devDependencies?.["@types/node"] !== undefined,
  );
  expect(carriers).toEqual(["vanilla", "effect-rpc"]);
});

test("the Effect example names its runtime", () => {
  expect(manifest("effect-rpc").dependencies?.effect).toBeDefined();
});
