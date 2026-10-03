import type { ImplementationId } from "../echo/echo-types.ts";
import { BASELINE_ID } from "../echo/echo-types.ts";
import type { ConfigurationResult } from "./summary.ts";
import { humanBytes } from "./units.ts";

const MISSING = "n/a";

const fixed = (value: number, digits: number): string => value.toFixed(digits);

const integer = (value: number | null): string =>
  value === null ? MISSING : Math.round(value).toLocaleString("en-US");

const legCell = (value: number | null, render: (input: number) => string): string =>
  value === null ? MISSING : render(value);

export const ratioAgainstBaseline = (result: ConfigurationResult, id: ImplementationId): string => {
  const baseline = result.legs[BASELINE_ID].medianRoundTripsPerSecond;
  const leg = result.legs[id].medianRoundTripsPerSecond;
  if (baseline === null || leg === null) return MISSING;
  return (leg / baseline).toFixed(3);
};

const rowOf = (result: ConfigurationResult, id: ImplementationId): string =>
  [
    humanBytes(result.payloadBytes),
    id,
    legCell(result.legs[id].medianSeconds, (value) => fixed(value, 4)),
    integer(result.legs[id].medianRoundTripsPerSecond),
    legCell(result.legs[id].medianWireBytesPerSecond, (value) => `${humanBytes(value)}/s`),
    ratioAgainstBaseline(result, id),
  ].join(" | ");

/// One row per payload and implementation: the long form stays readable at five
/// legs, where a column per implementation would triple the table's width.
export const table = (
  results: readonly ConfigurationResult[],
  implementations: readonly ImplementationId[],
): readonly string[] => [
  "",
  "| payload | implementation | median s | round trips/s | wire | vs ws |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.flatMap((result) => implementations.map((id) => `| ${rowOf(result, id)} |`)),
];
