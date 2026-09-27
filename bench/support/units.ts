const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/// Binary units throughout, matching `maxPayload` and the engine capacity,
/// which are both expressed in bytes. Decimal units would make a 32 KiB
/// ceiling read as a smaller number than the constant it comes from.
export const humanBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${UNITS[unit]}`;
};
