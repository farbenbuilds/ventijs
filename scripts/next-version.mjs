#!/usr/bin/env node
// The version transition table, as a pure function so it can be exercised without files.
//
// A merge carries a release directive: `release:<kind>` labels on its pull request, or the
// `bump.yml` dispatch inputs. With no directive a prerelease advances its counter, and a
// stable version starts the next patch's train on `alpha.0`; a stable version is otherwise
// only left behind by `stable` or by a base bump from a stable tree.
//
// `node scripts/next-version.mjs <current> <kind...>` prints any transition, so the table
// can be exercised by hand as well as by `tests/tooling/version.test.ts`.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const KINDS = ["major", "minor", "patch", "alpha", "beta", "rc", "stable"];
const BASES = ["major", "minor", "patch"];
const PREIDS = ["alpha", "beta", "rc"];

/// A version this project can advance: `X.Y.Z` or `X.Y.Z-<preid>`; the counter is optional
/// because `1.0.0-alpha` shipped before the counter convention did.
const PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z][a-z0-9-]*)(?:\.(\d+))?)?$/;

/// The version's parts, or null when the string is not one.
export function parseVersion(version) {
  const match = PATTERN.exec(version);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preid: match[4] ?? null,
    counter: match[5] === undefined ? 0 : Number(match[5]),
  };
}

/// The base bumped by `kind`, which is one of `BASES`.
function bumpBase(parts, kind) {
  if (kind === "major") return `${parts.major + 1}.0.0`;
  if (kind === "minor") return `${parts.major}.${parts.minor + 1}.0`;
  return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
}

/// The next version for `current` under the release directive `kinds`.
///
/// At most one base kind and one prerelease kind; `stable` drops the suffix. A base bump
/// from a stable version publishes that stable (`1.0.0` + `minor` -> `1.1.0`), where the
/// same bump inside a train starts the new base in the current train (`1.0.1-alpha.2` +
/// `major` -> `2.0.0-alpha.0`); add `stable` or a prerelease kind to pick the other outcome.
export function nextVersion(current, kinds) {
  const parts = parseVersion(current);
  if (parts === null) throw new Error(`next-version: ${current} is not a version`);
  for (const kind of kinds) {
    if (!KINDS.includes(kind)) throw new Error(`next-version: unknown release kind '${kind}'`);
  }
  const bases = kinds.filter((kind) => BASES.includes(kind));
  const preids = kinds.filter((kind) => PREIDS.includes(kind));
  if (bases.length > 1) throw new Error(`next-version: ${bases.join(" and ")} cannot combine`);
  if (preids.length > 1) throw new Error(`next-version: ${preids.join(" and ")} cannot combine`);
  const stable = kinds.includes("stable");
  const inTrain = parts.preid !== null;
  if (stable && !inTrain && bases.length === 0)
    throw new Error(`next-version: ${current} is already stable`);
  // A stable version with no base bump starts the next patch's train, so `beta` on 1.0.0
  // means 1.0.1-beta.0 rather than a version behind the one already published.
  const base =
    bases[0] === undefined
      ? inTrain
        ? `${parts.major}.${parts.minor}.${parts.patch}`
        : bumpBase(parts, "patch")
      : bumpBase(parts, bases[0]);
  if (stable || (!inTrain && bases.length > 0 && preids.length === 0)) return base;
  const id = preids[0] ?? parts.preid ?? "alpha";
  if (base === `${parts.major}.${parts.minor}.${parts.patch}` && id === parts.preid)
    return `${base}-${id}.${parts.counter + 1}`;
  return `${base}-${id}.0`;
}

/// The version a merge publishes. A version the tree states that has never been
/// tagged is the release as written, because the table would otherwise turn an
/// authored `1.0.0-beta` into `1.0.0-beta.1` before it had ever shipped. Once the
/// tag exists, the table advances it: every later merge is a new release.
export function releaseVersion(current, kinds, tagged) {
  return tagged ? nextVersion(current, kinds) : current;
}

/// -1, 0, or 1: a stable version is newer than its own prereleases, and a prerelease
/// counter compares within its id.
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null) throw new Error(`next-version: ${a} is not a version`);
  if (right === null) throw new Error(`next-version: ${b} is not a version`);
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) return Math.sign(left[part] - right[part]);
  }
  if (left.preid === right.preid) return Math.sign(left.counter - right.counter);
  if (left.preid === null) return 1;
  if (right.preid === null) return -1;
  return left.preid < right.preid ? -1 : 1;
}

const invoked =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invoked) {
  const [current, ...args] = process.argv.slice(2);
  const kinds = args.flatMap((arg) => arg.split(",")).filter((kind) => kind !== "");
  try {
    if (current === undefined)
      throw new Error("next-version: usage: next-version <current> <kind...>");
    console.log(nextVersion(current, kinds));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
