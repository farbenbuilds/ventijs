// The compact durable record for one benchmark run. It keeps every median and
// raw sample from the report, plus the workflow and runner provenance that a
// shared-runner series needs to compare runs within one hardware cohort.

import {
  BENCHMARK_ID,
  RECORD_SCHEMA_VERSION,
  assertReportMatchesContract,
  contractDigest,
  parseContract,
  readContract,
} from "./bench-contract.mjs";

const FORMULA =
  "candidate_median_round_trips_per_second >= baseline_median_round_trips_per_second * minimum_baseline_ratio";

const legsOf = (configuration, implementations) => {
  const legs = {};
  for (const id of implementations) {
    const leg = configuration.legs[id];
    legs[id] = {
      status: leg.reason === null ? "measured" : "unavailable",
      median_seconds: leg.medianSeconds,
      median_round_trips_per_second: leg.medianRoundTripsPerSecond,
      median_wire_bytes_per_second: leg.medianWireBytesPerSecond,
      spread: leg.spread,
      samples_seconds: leg.samples,
      reason: leg.reason,
    };
  }
  return legs;
};

const ratioOf = (configuration, contract) => {
  const baseline = configuration.legs[contract.gateBaseline]?.medianRoundTripsPerSecond ?? null;
  const candidate = configuration.legs[contract.gateCandidate]?.medianRoundTripsPerSecond ?? null;
  if (baseline === null || candidate === null) return null;
  return candidate / baseline;
};

export const buildRecord = ({ report, contractSource, recordedAt, workflow }) => {
  const contract = readContract(parseContract(contractSource));
  assertReportMatchesContract(report, contract);
  const { provenance } = report;
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    benchmark_id: BENCHMARK_ID,
    record_id: `${workflow.runId}-${workflow.runAttempt}-${workflow.commitSha.slice(0, 12)}`,
    recorded_at: recordedAt,
    guarantee: {
      formula: FORMULA,
      minimum_baseline_ratio: contract.gateMinimumRatio,
      passed: report.gate?.failed === false,
    },
    methodology: {
      contract_sha256: contractDigest(contractSource),
      statistic: "median",
      messages: contract.messages,
      repeats: contract.repeats,
      warmups: contract.warmups,
      payload_sizes_bytes: contract.payloadSizes,
      per_message_deflate: false,
      wire_bytes_basis: contract.wireBytesBasis,
      implementations: contract.implementations,
      gate_baseline: contract.gateBaseline,
      gate_candidate: contract.gateCandidate,
    },
    provenance: {
      repository: workflow.repository,
      event_name: workflow.eventName,
      git_ref: workflow.gitRef,
      commit_sha: workflow.commitSha,
      workflow_run_url: workflow.workflowRunUrl,
      run_id: workflow.runId,
      run_attempt: workflow.runAttempt,
    },
    runner: {
      os: workflow.runnerOs,
      architecture: workflow.runnerArch,
      name: workflow.runnerName,
      image: workflow.runnerImage,
      cpu_model: provenance.cpuModel,
      cpu_count: provenance.cpuCount,
      kernel: workflow.kernel,
      total_memory_bytes: provenance.totalMemoryBytes,
    },
    toolchain: {
      node_version: provenance.nodeVersion,
      node_abi: provenance.nodeAbi,
      pnpm_version: provenance.pnpmVersion,
      zig_version: provenance.zigVersion,
      lockfile_sha256: provenance.lockfileSha256,
      ventiws_version: provenance.ventiwsVersion,
      ws_version: provenance.wsVersion,
      uweb_sockets_version: provenance.uwebSocketsVersion,
      socket_io_version: provenance.socketIoVersion,
      socket_io_client_version: provenance.socketIoClientVersion,
    },
    results: {
      configurations: report.configurations.map((configuration) => ({
        payload_bytes: configuration.payloadBytes,
        candidate_to_baseline_ratio: ratioOf(configuration, contract),
        legs: legsOf(configuration, contract.implementations),
      })),
    },
  };
};
