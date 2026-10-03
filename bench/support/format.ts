import { table } from "./format-table.ts";
import type { BenchmarkReport } from "./report.ts";
import type { Leg } from "./summary.ts";
import { humanBytes } from "./units.ts";

const MISSING = "n/a";

const spreadCell = (leg: Leg): string =>
  leg.spread === null ? MISSING : `${(leg.spread * 100).toFixed(1)}%`;

const header = (report: BenchmarkReport): readonly string[] => {
  const { provenance: p, parameters: a } = report;
  return [
    `ventiws echo benchmark (${p.schemaVersion})`,
    `commit    ${p.gitCommit}${p.gitDirty ? " (dirty tree)" : ""}`,
    `toolchain node ${p.nodeVersion} (ABI ${p.nodeAbi})  pnpm ${p.pnpmVersion}  zig ${p.zigVersion}`,
    `lockfile  ${p.lockfileSha256.slice(0, 16)}  ventiws ${p.ventiwsVersion}  ws ${p.wsVersion}`,
    `refs      uWebSockets.js ${p.uwebSocketsVersion}  socket.io ${p.socketIoVersion}  socket.io-client ${p.socketIoClientVersion}`,
    `host      ${p.cpuModel} x${p.cpuCount}  ${p.platform}/${p.arch}  ${humanBytes(p.totalMemoryBytes)} RAM`,
    `workload  ${a.messages} round trips per sample, lock-step echo, perMessageDeflate off`,
    `samples   ${a.repeats} measured repeats per configuration, ${a.warmupRepeatsDiscarded} warm-up repeats discarded`,
    `gate      ${a.gateCandidate} must reach ${a.gateMinimumRatio} of ${a.gateBaseline} per payload`,
    `ceiling   ventiws is capped at ${humanBytes(a.payloadCeilingBytes)} per message by its pinned engine;`,
    `          ws accepts far more, so a row above the ceiling would compare a missing capability, not a speed.`,
    `fairness  ${a.wireBytesBasis} wire bytes on every leg; Socket.IO adds Engine.IO framing over websocket-only`,
    `          transport, so its time includes overhead its bytes column omits.`,
  ];
};

const notes = (report: BenchmarkReport): readonly string[] => {
  const lines: string[] = [];
  for (const result of report.configurations) {
    for (const id of report.parameters.implementations) {
      const leg = result.legs[id];
      if (leg.reason !== null) lines.push(`- ${result.configuration}: ${id} ${leg.reason}`);
      if (leg.spread !== null && leg.spread > 0.1) {
        lines.push(
          `- ${result.configuration}: ${id} sample spread ${spreadCell(leg)} exceeds 10 percent; the host was not quiet`,
        );
      }
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
    ...table(report.configurations, report.parameters.implementations),
    ...notes(report),
    ...gate(report, gateEnabled),
  ].join("\n");
