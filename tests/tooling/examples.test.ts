// The runtime examples deliberately differ: each keeps the same ventiws server but reads its
// host's environment API and dials with its host's client, so a shared `index.ts` would undo
// the teaching. The Effect RPC example is a multi-file project held to the manifest rules.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const EXAMPLES = ["vanilla", "bun", "deno", "effect-rpc"];

type Manifest = {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const example = (runtime: string, file: string) => read(`examples/${runtime}-ventiws/${file}`);
const manifest = (runtime: string) => JSON.parse(example(runtime, "package.json")) as Manifest;

test("each runtime example names its own host API", () => {
  expect(example("vanilla", "index.ts")).toContain("process.env");
  expect(example("bun", "index.ts")).toContain("Bun.env");
  expect(example("deno", "index.ts")).toContain("Deno.env.get");
  expect(example("deno", "index.ts")).toContain("Deno.exitCode");
});

test("only the Node example dials with the ventiws client", () => {
  expect(example("vanilla", "index.ts")).toContain("{ WebSocket, WebSocketServer }");
  expect(example("bun", "index.ts")).toContain("{ WebSocketServer }");
  expect(example("deno", "index.ts")).toContain("{ WebSocketServer }");
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
