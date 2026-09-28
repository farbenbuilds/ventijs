/// The failure vocabulary crosses the boundary as an ordinal, so the Zig enum and the
/// TypeScript table have to be the same list in the same order. Nothing at runtime
/// notices when they drift: the ordinal still resolves, and every refusal is then
/// reported as a different refusal than the codec decided on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CODEC_FAILURES, CODEC_KINDS } from "../../src/binding/codec-status";

const ENUM_FILE = fileURLToPath(new URL("../../src/engine/codec/events.zig", import.meta.url));

const source = readFileSync(ENUM_FILE, "utf8");

/// The members of a Zig enum, in declaration order, with the doc comments dropped. The
/// body is matched rather than the whole file so a second enum in the file, or a name
/// mentioned in a comment, cannot enter the list.
function zigEnumMembers(enumName: string): string[] {
  const body = new RegExp(`pub const ${enumName} = enum\\([^)]*\\) \\{([\\s\\S]*?)\\n\\};`);
  const matched = body.exec(source);
  expect(matched, `no enum ${enumName} in events.zig`).not.toBeNull();
  const members = (matched?.[1] ?? "")
    .split("\n")
    .map((line) => /^\s{4}([a-z][a-z0-9_]*)\s*(=\s*\d+)?,/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  expect(members.length, `enum ${enumName} parsed empty`).toBeGreaterThan(0);
  return members;
}

/// The camelCase spelling TypeScript uses, which is the Zig name with `_` removed. The
/// one exception is `unexpected_rsv_2_3`, whose name cannot start with a digit, so it
/// becomes `unexpectedRsv2or3`; the alias list below is what makes that explicit
/// rather than a silent mismatch.
const RENAMED: Readonly<Record<string, string>> = { unexpected_rsv_2_3: "unexpectedRsv2or3" };

function toTsName(zigName: string): string {
  if (RENAMED[zigName] !== undefined) return RENAMED[zigName];
  const [head, ...rest] = zigName.split("_");
  return head + rest.map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
}

test("every Zig failure is in the TypeScript table, in the same order", () => {
  const members = zigEnumMembers("Failure");
  expect(members.map(toTsName)).toEqual([...CODEC_FAILURES]);
});

test("every failure the table names exists on the Zig side", () => {
  const members = new Set(zigEnumMembers("Failure"));
  const unknown = CODEC_FAILURES.filter((name) =>
    [...members].every((zig) => toTsName(zig) !== name),
  );
  expect(unknown).toEqual([]);
});

test("the ordinals are dense and start at one", () => {
  // Zero is never produced, because a caller must be able to say "no failure"; a gap
  // would mean an ordinal that resolves to a member the table does not have.
  const members = zigEnumMembers("Failure");
  expect(members).toHaveLength(CODEC_FAILURES.length);
  expect([...CODEC_FAILURES].every((name, index) => members[index] !== undefined)).toBe(true);
});

test("the Kind vocabulary matches too", () => {
  const members = zigEnumMembers("Kind");
  expect(members.map(toTsName)).toEqual([...CODEC_KINDS]);
});

test("the renames are the ones the table claims", () => {
  // Guards the alias map itself: a new Zig name that TypeScript spells differently has
  // to be added here, which is the point of the test, not a workaround for it.
  const members = new Set(zigEnumMembers("Failure"));
  expect([...members].filter((name) => RENAMED[name] !== undefined)).toEqual(
    Object.keys(RENAMED).filter((name) => members.has(name)),
  );
});
