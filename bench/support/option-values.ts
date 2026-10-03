export const readCount = (
  flag: string,
  raw: string | undefined,
  fallback: number,
  minimum = 1,
): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${flag} expects an integer of at least ${minimum}, received "${raw}"`);
  }
  return value;
};

export const readSizes = (
  flag: string,
  raw: string | undefined,
  fallback: readonly number[],
): readonly number[] => {
  if (raw === undefined) return fallback;
  const sizes = raw.split(",").map((field) => readCount(flag, field.trim(), 0));
  if (sizes.length === 0) throw new Error(`${flag} expects at least one payload size`);
  return sizes;
};
