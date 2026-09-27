/// What a real report measured, kept beside the table it validates so the two
/// cannot drift apart without the self-check noticing.
///
/// Run 36287763043 realised 301 framing cases. Group 6 is 145 of them, not the 91
/// the suite's own case expansion suggests, and group 9 is 54 rather than 108: an
/// earlier derivation had both the wrong way round and only its totals matched,
/// which is exactly the weakness a sum-based consistency check has. Pinning the
/// per-group counts turns that check into a comparison.
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

/// The suite step of that run, and what its report says the cases cost.
///
/// The two disagree by three orders of magnitude, and the difference is the
/// point: `duration` spans `onOpen` to `connectionLost`, so it excludes the
/// connect and the opening handshake the client does per case.
export const MEASURED_SUITE_SECONDS = 14;
export const MEASURED_REPORTED_DURATION_SECONDS = 12;
export const MEASURED_SHARDS = 4;
export const MEASURED_CASES = 301;
