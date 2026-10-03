// A new benchmark ID starts a new history series. The publisher archives the previous
// index beside the records so v1 stays reachable from the branch after v2 takes over.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { publishRecord } from "../../scripts/bench-history.mjs";
import { build, publishInput, reportOf } from "./bench-fixtures";

test("a new benchmark series archives the previous index", () => {
  const history = mkdtempSync(join(tmpdir(), "ventiws-bench-series-"));
  writeFileSync(
    join(history, "index.json"),
    `${JSON.stringify({ schema_version: 1, benchmark_id: "echo-throughput-v1", records: [] })}\n`,
  );
  publishRecord(publishInput(build(reportOf()), history));
  const archived = JSON.parse(
    readFileSync(join(history, "index-echo-throughput-v1.json"), "utf8"),
  ) as { benchmark_id: string };
  const active = JSON.parse(readFileSync(join(history, "index.json"), "utf8")) as {
    benchmark_id: string;
  };
  expect(archived.benchmark_id).toBe("echo-throughput-v1");
  expect(active.benchmark_id).toBe("echo-throughput-v2");
});
