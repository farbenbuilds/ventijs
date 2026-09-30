import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { EngineEvent, VentiAddon } from "../../src/binding/native.ts";
import { PACKAGE_ROOT } from "./paths.ts";

/// `src/binding` uses extensionless relative imports, which Node's type
/// stripping cannot resolve at runtime; only the ABI declaration is reused
/// here, and it is erased before execution. The addon itself is loaded the way
/// `src/binding/load.ts` loads it, with the same candidate order, so the target
/// and the unit tests exercise the same artifact.
const CANDIDATE_PATHS = [
  ["zig-out", "lib", "ventiws.node"],
  ["dist", "ventiws.node"],
] as const;

const require = createRequire(import.meta.url);

function resolveAddonPath(): string {
  for (const parts of CANDIDATE_PATHS) {
    const candidate = join(PACKAGE_ROOT, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `ventiws: native addon not found under ${PACKAGE_ROOT}; run "pnpm build:binding" first`,
  );
}

let addon: VentiAddon | undefined;

export function loadVentiwsAddon(): VentiAddon {
  addon ??= require(resolveAddonPath()) as VentiAddon;
  return addon;
}

export type { EngineEvent, VentiAddon };

export type EchoState = {
  handle: number;
  connection: bigint | null;
};

/// A connection handle is `generation << 32 | index`, the packing `src/binding/handle.ts` does.
export function echoState(): EchoState {
  return { handle: 0, connection: null };
}

export function pack(index: number, generation: number): bigint {
  return (BigInt(generation) << 32n) | BigInt(index);
}

/// Reply to every message with the same opcode and change nothing else: anything smarter makes a
/// case pass or fail for a reason the report cannot name.
///
/// The inbound ring is FIFO across the whole server, so this drains until empty: a coalesced
/// wakeup would leave messages waiting for an event that never comes.
export function reply(a: VentiAddon, state: EchoState): void {
  const connection = state.connection;
  if (connection === null) return;
  for (;;) {
    const taken = a.takeSocketMessage(state.handle, connection);
    if (taken === null) return;
    const [bytes, isBinary] = taken;
    if (a.sendSocket(state.handle, connection, bytes, isBinary) !== 0) return;
    a.pumpSocket(state.handle, connection);
  }
}

/// A case that lost the race leaves records at the head of a strictly ordered FIFO, and nothing
/// could match them.
export function purge(a: VentiAddon, state: EchoState, index: number, generation: number): void {
  a.purgeSocketMessage(state.handle, index, generation);
}

/// The contract between the target and the runner: one newline-delimited JSON
/// record on stdout, tagged with a prefix so unrelated child output can be
/// forwarded to the runner's log without being mistaken for the handshake.

export const READY_PREFIX = "ventiws-autobahn-target ";

/// The capacity the engine was compiled with. `message_capacity` in
/// `src/engine/server/options.zig` is a Zig `comptime` constant baked into the
/// addon, so the target reports the value it actually passes to the engine
/// rather than a number the harness assumed.
export type TargetReady = {
  readonly host: string;
  readonly port: number;
  readonly engine: string;
  readonly maxFrameBytes: number;
  readonly maxMessageBytes: number;
  readonly echo: boolean;
  readonly echoReason: string | null;
};

function isReadyShape(value: unknown): value is TargetReady {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<TargetReady>;
  return (
    typeof record.port === "number" &&
    typeof record.host === "string" &&
    typeof record.echo === "boolean" &&
    typeof record.maxFrameBytes === "number" &&
    typeof record.maxMessageBytes === "number"
  );
}

export function encodeTargetReady(record: TargetReady): string {
  return `${READY_PREFIX}${JSON.stringify(record)}`;
}

/// Returns null for any line that is not the ready record, so the caller can
/// forward it instead of failing the run on unrelated child output.
export function decodeTargetReady(line: string): TargetReady | null {
  if (!line.startsWith(READY_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(READY_PREFIX.length));
  } catch {
    return null;
  }
  if (!isReadyShape(parsed)) return null;
  return parsed;
}
