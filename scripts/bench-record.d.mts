// Type surface for the record builder. The implementation is plain JavaScript;
// only the exported function and the fields its tests read are described.
export type RecordWorkflow = {
  readonly repository: string;
  readonly eventName: string;
  readonly gitRef: string;
  readonly commitSha: string;
  readonly workflowRunUrl: string;
  readonly runId: number;
  readonly runAttempt: number;
  readonly runnerOs: string;
  readonly runnerArch: string;
  readonly runnerName: string;
  readonly runnerImage: string;
  readonly kernel: string;
};
export type BenchmarkRecord = {
  readonly schema_version: number;
  readonly benchmark_id: string;
  readonly record_id: string;
  readonly recorded_at: string;
  readonly guarantee: {
    readonly minimum_baseline_ratio: number;
    readonly passed: boolean;
  };
  readonly methodology: {
    readonly contract_sha256: string;
    readonly messages: number;
    readonly implementations: readonly string[];
    readonly gate_baseline: string;
    readonly gate_candidate: string;
  };
  readonly provenance: {
    readonly commit_sha: string;
  };
  readonly results: {
    readonly configurations: readonly {
      readonly payload_bytes: number;
      readonly candidate_to_baseline_ratio: number | null;
      readonly legs: Readonly<
        Record<string, { readonly median_round_trips_per_second: number | null }>
      >;
    }[];
  };
};
export declare function buildRecord(input: {
  readonly report: unknown;
  readonly contractSource: string;
  readonly recordedAt: string;
  readonly workflow: RecordWorkflow;
}): BenchmarkRecord;
