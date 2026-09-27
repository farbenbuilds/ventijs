/// The contract between the target and the runner: one newline-delimited JSON
/// record on stdout, tagged with a prefix so unrelated child output can be
/// forwarded to the runner's log without being mistaken for the handshake.

export const READY_PREFIX = "ventijs-autobahn-target ";

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
