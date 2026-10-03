// Type surface for the history writer. The implementation is plain JavaScript;
// only the exported function and the input fields its tests exercise are
// described.
import type { BenchmarkRecord } from "./bench-record.mjs";

export declare const RECORD_ID_PATTERN: RegExp;
export declare function publishRecord(input: {
  readonly record: BenchmarkRecord;
  readonly reportSource: string;
  readonly historyDirectory: string;
  readonly contractSource: string;
  readonly contractName: string;
  readonly schemaSource: string;
  readonly schemaName: string;
  readonly contractDocSource: string;
  readonly contractDocName: string;
}): string;
