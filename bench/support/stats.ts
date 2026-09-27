export const median = (samples: readonly number[]): number => {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort(ascending);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const ascending = (left: number, right: number): number => left - right;

/// The spread between the best and the worst sample as a fraction of the median.
/// A wide spread means the host was not quiet, and a median from such a run is
/// not evidence of anything, so the number is reported instead of hidden.
export const spread = (samples: readonly number[]): number => {
  if (samples.length === 0) return Number.NaN;
  const center = median(samples);
  if (center === 0) return Number.NaN;
  let lowest = samples[0];
  let highest = samples[0];
  for (const sample of samples) {
    if (sample < lowest) lowest = sample;
    if (sample > highest) highest = sample;
  }
  return (highest - lowest) / center;
};
