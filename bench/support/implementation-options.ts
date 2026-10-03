import type { ImplementationId } from "../echo/echo-types.ts";
import { isImplementationId } from "../echo/echo-types.ts";

/// The reader's order is preserved so the plan and the report table iterate the
/// same stable sequence; a repeated id would double-count a leg in every median.
export const readImplementations = (
  flag: string,
  raw: string | undefined,
  fallback: readonly ImplementationId[],
): readonly ImplementationId[] => {
  if (raw === undefined) return fallback;
  const fields = raw.split(",").map((field) => field.trim());
  if (fields.length === 0) throw new Error(`${flag} expects at least one implementation`);
  const ids: ImplementationId[] = [];
  for (const field of fields) {
    if (!isImplementationId(field)) {
      throw new Error(`${flag} has unknown implementation "${field}"`);
    }
    if (ids.includes(field)) throw new Error(`${flag} repeats implementation "${field}"`);
    ids.push(field);
  }
  return ids;
};
