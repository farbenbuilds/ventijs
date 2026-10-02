import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";
import { runtimeGlobals } from "./runtime";

/// The two libc families the published Linux packages split on.
export type HostLibc = "gnu" | "musl";

/// Only Linux probes; every other platform answers gnu, which no off-Linux target reads.
export function hostLibc(): HostLibc {
  if (process.platform !== "linux") return "gnu";
  const declared = denoLibc() ?? reportLibc();
  if (declared !== undefined) return declared;
  return probeMusl() ? "musl" : "gnu";
}

/// `Deno.build.env` is the target ABI and `target` is the full triple, so Deno answers
/// directly; it leads because Deno's report may be a stub rather than a diagnostic.
function denoLibc(): HostLibc | undefined {
  const build = runtimeGlobals().Deno?.build;
  const marker = `${build?.env ?? ""} ${build?.target ?? ""}`;
  if (marker.includes("musl")) return "musl";
  if (marker.includes("gnu")) return "gnu";
  return undefined;
}

/// A report that does not answer defers to the probes: Bun's report is glibc-only, and
/// Deno's may be absent or throw.
function reportLibc(): HostLibc | undefined {
  const facts = reportFacts();
  if (facts === undefined) return undefined;
  if (facts.glibcVersionRuntime !== undefined) return "gnu";
  if (isMuslSharedObject(facts.sharedObjects)) return "musl";
  return undefined;
}

type ReportFacts = { glibcVersionRuntime?: string; sharedObjects?: string[] };

/// `getReport` is typed as a bare `object` and is a string on some builds, so it is
/// narrowed rather than asserted; one that will not answer counts as absent.
function reportFacts(): ReportFacts | undefined {
  try {
    const report = process.report;
    if (report === undefined || typeof report.getReport !== "function") return undefined;
    return narrowReport(report.getReport());
  } catch {
    return undefined;
  }
}

function narrowReport(raw: unknown): ReportFacts | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const facts: ReportFacts = {};
  const glibc = asRecord(record.header)?.glibcVersionRuntime;
  if (typeof glibc === "string") facts.glibcVersionRuntime = glibc;
  const objects = record.sharedObjects;
  if (Array.isArray(objects))
    facts.sharedObjects = objects.filter((entry) => typeof entry === "string");
  return facts;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") return parsedJson(value);
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function parsedJson(source: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(source));
  } catch {
    return undefined;
  }
}

function isMuslSharedObject(sharedObjects: string[] | undefined): boolean {
  if (sharedObjects === undefined) return false;
  return sharedObjects.some((entry) => entry.includes("libc.musl-") || entry.includes("ld-musl-"));
}

/// The loader is the one signal a Bun/musl report does not carry; after it a readable
/// `ldd` names itself, then the command does, and a host that answers neither is gnu.
function probeMusl(): boolean {
  if (hasMuslLoader()) return true;
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return probeLddVersion();
  }
}

function hasMuslLoader(): boolean {
  try {
    return readdirSync("/lib").some((entry) => entry.startsWith("ld-musl-"));
  } catch {
    return false;
  }
}

function probeLddVersion(): boolean {
  try {
    const output = execFileSync("ldd", ["--version"], { encoding: "utf8" });
    return output.includes("musl");
  } catch {
    return false;
  }
}
