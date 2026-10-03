// The benchmark contract is stated twice: as code defaults in `bench/support/`
// and as the frozen env file the publisher hashes. The two must agree, because
// a run whose parameters drifted from the contract is refused at publication
// and would leave the history with a gap.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ALL_IMPLEMENTATION_IDS, BASELINE_ID, CANDIDATE_ID } from "../../bench/echo/echo-types";
import {
  DEFAULT_MESSAGES,
  DEFAULT_PAYLOAD_SIZES,
  DEFAULT_REPEATS,
  DEFAULT_WARMUPS,
  GATE_MIN_RATIO,
} from "../../bench/support/options";
import { SCHEMA_VERSION } from "../../bench/support/provenance";
import {
  BENCHMARK_ID,
  RECORD_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  parseContract,
  readContract,
} from "../../scripts/bench-contract.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const CONTRACT = readContract(parseContract(read("bench/contracts/echo_throughput_v2.env")));

type SchemaNode = {
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
};

const SCHEMA = JSON.parse(read("bench/contracts/echo_throughput_v2.schema.json")) as SchemaNode;

test("the contract matches the harness defaults it freezes", () => {
  expect(CONTRACT.implementations).toEqual([...ALL_IMPLEMENTATION_IDS]);
  expect(CONTRACT.gateBaseline).toBe(BASELINE_ID);
  expect(CONTRACT.gateCandidate).toBe(CANDIDATE_ID);
  expect(CONTRACT.gateMinimumRatio).toBe(GATE_MIN_RATIO);
  expect(CONTRACT.payloadSizes).toEqual([...DEFAULT_PAYLOAD_SIZES]);
  expect(CONTRACT.messages).toBe(DEFAULT_MESSAGES);
  expect(CONTRACT.repeats).toBe(DEFAULT_REPEATS);
  expect(CONTRACT.warmups).toBe(DEFAULT_WARMUPS);
  expect(CONTRACT.wireBytesBasis).toBe("payload-only");
});

test("the publisher accepts the report schema the harness writes", () => {
  expect(REPORT_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
});

test("the record schema pins the benchmark identity and the gate", () => {
  const properties = SCHEMA.properties ?? {};
  expect(properties.benchmark_id?.const).toBe(BENCHMARK_ID);
  expect(properties.schema_version?.const).toBe(RECORD_SCHEMA_VERSION);
  const guarantee = properties.guarantee?.properties ?? {};
  expect(guarantee.minimum_baseline_ratio?.const).toBe(GATE_MIN_RATIO);
  expect(guarantee.formula?.const).toContain("minimum_baseline_ratio");
});
