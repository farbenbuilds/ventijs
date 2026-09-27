import { KNOWN_FAILURES } from "./baseline.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { INBOUND_LIMIT_BYTES } from "./expected-cases.ts";
import { MODE_COUNTS } from "./suite-mode.ts";
import type { GateCounts, GateResult } from "./gate.ts";
import type { CaseReport } from "./report-index.ts";
import type { EchoProbe } from "./probe-echo.ts";

/// Everything CI needs to upload from a failed run, in one file. The suite's
/// own HTML and JSON reports land next to it under `reports/servers`, but they
/// only exist once `wstest` has run, so this summary is written on every exit
/// path including the ones where the suite never started.
export type AutobahnSummary = {
  /// Which case selection produced this run, so a report says what it covered.
  readonly mode: "framing" | "full";
  readonly ok: boolean;
  readonly agent: string;
  readonly image: string;
  readonly inboundLimitBytes: number;
  readonly expected: {
    readonly total: number;
    readonly capacity: number;
    readonly evaluated: number;
  };
  readonly target: EchoProbe | null;
  readonly suiteRun: boolean;
  readonly counts: GateResult["counts"] | null;
  readonly violations: GateResult["violations"];
  readonly cases: readonly CaseReport[];
  readonly failure: string | null;
};

export function buildSummary(input: {
  readonly ok: boolean;
  readonly mode: "framing" | "full";
  readonly agent: string;
  readonly image: string;
  readonly target: EchoProbe | null;
  readonly suiteRun: boolean;
  readonly gate: GateResult | null;
  readonly cases: readonly CaseReport[];
  readonly failure: string | null;
}): AutobahnSummary {
  const expected = MODE_COUNTS[input.mode];
  return {
    ok: input.ok,
    mode: input.mode,
    agent: input.agent,
    image: input.image,
    inboundLimitBytes: INBOUND_LIMIT_BYTES,
    expected: {
      total: expected.total,
      capacity: expected.capacity,
      evaluated: expected.evaluated,
    },
    target: input.target,
    suiteRun: input.suiteRun,
    counts: input.gate?.counts ?? null,
    violations: input.gate?.violations ?? [],
    cases: input.cases,
    failure: input.failure,
  };
}

export function writeSummary(path: string, summary: AutobahnSummary): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function describeCounts(counts: GateCounts, mode: "framing" | "full"): readonly string[] {
  const expected = MODE_COUNTS[mode];
  return [
    `cases      ${counts.total} (expected ${expected.total})`,
    `passed     ${counts.passed} of ${expected.evaluated} evaluated`,
    `failed     ${counts.failed}`,
    `capacity   ${counts.capacity} of ${expected.capacity} above ${INBOUND_LIMIT_BYTES} bytes`,
    `non-strict ${counts.nonStrict}`,
  ];
}

export function formatSummary(summary: AutobahnSummary): string {
  const lines: string[] = ["autobahn: report gate"];
  lines.push(
    `mode       ${summary.mode}${summary.mode === "framing" ? " (deflate groups omitted)" : ""}`,
  );
  if (summary.target !== null) {
    lines.push(
      `target     port ${summary.target.port} engine ${summary.target.engine} echo ${String(summary.target.echo)}`,
    );
  }
  if (summary.failure !== null) lines.push(`blocked    ${summary.failure}`);
  if (!summary.suiteRun) lines.push("suite      not run");
  if (summary.counts !== null) lines.push(...describeCounts(summary.counts, summary.mode));
  lines.push(
    `baseline   ${KNOWN_FAILURES.size} known failures across ${KNOWN_FAILURES.groups.length} groups`,
  );
  for (const group of KNOWN_FAILURES.groups) {
    lines.push(
      `  group ${group.group.padEnd(3)} ${String(group.count).padStart(3)} cases  ${group.reason}`,
    );
  }
  for (const violation of summary.violations)
    lines.push(`  [${violation.kind}] ${violation.detail}`);
  lines.push(`result     ${summary.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
