// Type surface for the contract reader the publisher and its tests share. The
// implementation is plain JavaScript; only the exported functions are described.
export declare const BENCHMARK_ID: string;
export declare const RECORD_SCHEMA_VERSION: number;
export declare const REPORT_SCHEMA_VERSION: string;
export declare function parseContract(source: string): Map<string, string>;
export declare function contractDigest(source: string): string;
export type BenchmarkContract = {
  readonly implementations: readonly string[];
  readonly gateBaseline: string;
  readonly gateCandidate: string;
  readonly gateMinimumRatio: number;
  readonly payloadSizes: readonly number[];
  readonly messages: number;
  readonly repeats: number;
  readonly warmups: number;
  readonly wireBytesBasis: string;
};
export declare function readContract(entries: Map<string, string>): BenchmarkContract;
export declare function assertReportMatchesContract(
  report: unknown,
  contract: BenchmarkContract,
): void;
