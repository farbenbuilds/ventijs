/// What a real report measured, kept beside the table it validates. Run 36287763043
/// realised 301 framing cases with group 6 at 145 and group 9 at 54, so per-group counts
/// are pinned rather than the sum.
export const MEASURED_FRAMING_COUNTS: Readonly<Record<string, number>> = {
  "1": 16,
  "2": 11,
  "3": 7,
  "4": 10,
  "5": 20,
  "6": 145,
  "7": 37,
  "9": 54,
  "10": 1,
};

/// What the report says each case cost, which disagrees with the measured step by three
/// orders of magnitude: `duration` spans `onOpen` to `connectionLost`.
export const MEASURED_SUITE_SECONDS = 14;
export const MEASURED_REPORTED_DURATION_SECONDS = 12;
export const MEASURED_SHARDS = 4;
export const MEASURED_CASES = 301;
