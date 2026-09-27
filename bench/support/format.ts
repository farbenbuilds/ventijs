import { humanBytes } from "./units.ts";
import type { ConfigurationResult, Leg } from "./plan.ts";
import type { BenchmarkReport } from "./report.ts";

const MISSING = "n/a";

const fixed = (value: number, digits: number): string => value.toFixed(digits);

const integer = (value: number | null): string =>
  value === null ? MISSING : Math.round(value).toLocaleString("en-US");

const legCell = (value: number | null, render: (input: number) => string): string =>
  value === null ? MISSING : render(value);

const outcomeOf = (result: ConfigurationResult): string => {
  const ws = result.ws.medianRoundTripsPerSecond;
  const ventijs = result.ventijs.medianRoundTripsPerSecond;
  if (ws === null || ventijs === null) return "unverified";
  return (ventijs / ws).toFixed(3);
};

const rowOf = (result: ConfigurationResult): string =>
  [
    humanBytes(result.payloadBytes),
    legCell(result.ws.medianSeconds, (value) => fixed(value, 4)),
    integer(result.ws.medianRoundTripsPerSecond),
    legCell(result.ws.medianWireBytesPerSecond, (value) => `${humanBytes(value)}/s`),
    legCell(result.ventijs.medianSeconds, (value) => fixed(value, 4)),
    integer(result.ventijs.medianRoundTripsPerSecond),
    legCell(result.ventijs.medianWireBytesPerSecond, (value) => `${humanBytes(value)}/s`),
    outcomeOf(result),
  ].join(" | ");

const spreadCell = (leg: Leg): string =>
  leg.spread === null ? MISSING : `${(leg.spread * 100).toFixed(1)}%`;

const header = (report: BenchmarkReport): readonly string[] => {
  const { provenance: p, parameters: a } = report;
  return [
    `ventijs echo benchmark (${p.schemaVersion})`,
    `commit    ${p.gitCommit}${p.gitDirty ? " (dirty tree)" : ""}`,
    `toolchain node ${p.nodeVersion}  pnpm ${p.pnpmVersion}  zig ${p.zigVersion}`,
    `lockfile  ${p.lockfileSha256.slice(0, 16)}  ventijs ${p.ventijsVersion}  ws ${p.wsVersion}`,
    `host      ${p.cpuModel} x${p.cpuCount}  ${p.platform}/${p.arch}  ${humanBytes(p.totalMemoryBytes)} RAM`,
    `workload  ${a.messages} round trips per sample, lock-step echo, perMessageDeflate off`,
    `samples   ${a.repeats} measured repeats per configuration, ${a.warmupRepeatsDiscarded} warm-up repeats discarded`,
    `ceiling   ventijs is capped at ${humanBytes(a.payloadCeilingBytes)} per message by its pinned engine;`,
    `          ws accepts far more, so a row above the ceiling would compare a missing capability, not a speed.`,
  ];
};

const table = (results: readonly ConfigurationResult[]): readonly string[] => [
  "",
  "| payload | ws median s | ws round trips/s | ws wire | ventijs median s | ventijs round trips/s | ventijs wire | ventijs vs ws |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...results.map((result) => `| ${rowOf(result)} |`),
];

const notes = (results: readonly ConfigurationResult[]): readonly string[] => {
  const lines: string[] = [];
  for (const result of results) {
    if (result.ws.reason !== null) lines.push(`- ${result.configuration}: ws ${result.ws.reason}`);
    if (result.ventijs.reason !== null)
      lines.push(`- ${result.configuration}: ventijs ${result.ventijs.reason}`);
    if (result.ws.spread !== null && result.ws.spread > 0.1) {
      lines.push(
        `- ${result.configuration}: ws sample spread ${spreadCell(result.ws)} exceeds 10 percent; the host was not quiet`,
      );
    }
  }
  if (lines.length === 0) return [];
  return ["", "notes", ...lines];
};

const gate = (report: BenchmarkReport, enabled: boolean): readonly string[] => [
  "",
  enabled ? "gate" : "gate (not enforced, pass --gate to enforce)",
  ...report.gate.lines.map((line) => `  ${line}`),
];

/// Markdown on purpose: the table is pasted straight into a pull request, and
/// `CI_CD_PIPELINE.md` treats a run as evidence only when its provenance
/// travels with the numbers.
export const renderReport = (report: BenchmarkReport, gateEnabled: boolean): string =>
  [
    ...header(report),
    ...table(report.configurations),
    ...notes(report.configurations),
    ...gate(report, gateEnabled),
  ].join("\n");
