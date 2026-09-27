import type { EngineDispatch, NativeServerConfig } from "./native";
import { callNative } from "./errors";
import { loadAddon } from "./load";

export type ServerHandle = number;

/// The native side packs the slot byte and a 32 bit generation into a u40.
const MAX_SERVER_HANDLE = 2 ** 40 - 1;

/// napi-zig narrows JS numbers with `napi_get_value_int64`, which truncates
/// fractions and turns `NaN` into a different listener configuration. Reject
/// anything that is not already an integer before the native call.
const INTEGER_CONFIG_FIELDS = [
  "port",
  "backlog",
  "maxConnections",
  "maxMessageBytes",
  "maxFrameBytes",
] as const;

export function assertServerHandle(handle: ServerHandle): void {
  if (!Number.isSafeInteger(handle) || handle < 0 || handle > MAX_SERVER_HANDLE) {
    throw new RangeError(`ventijs: server handle must be a uint40, got ${handle}`);
  }
}

function assertConfigIntegers(config: NativeServerConfig): void {
  for (const field of INTEGER_CONFIG_FIELDS) {
    const value = config[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `ventijs: server config "${field}" must be a safe integer, got ${value}`,
      );
    }
  }
}

export function createServer(config: NativeServerConfig, dispatch: EngineDispatch): ServerHandle {
  assertConfigIntegers(config);
  const addon = loadAddon();
  const handle = callNative(() => addon.createServer(config, dispatch));
  assertServerHandle(handle);
  return handle;
}

export function listenServer(handle: ServerHandle): void {
  assertServerHandle(handle);
  const addon = loadAddon();
  callNative(() => addon.listenServer(handle));
}

export function closeServer(handle: ServerHandle): void {
  assertServerHandle(handle);
  const addon = loadAddon();
  callNative(() => addon.closeServer(handle));
}

/// Releases native resources. Must run after `serverClosed` has been
/// dispatched; finalizing while events are queued throws `EventsPending`
/// instead of freeing memory a callback still references.
export function finalizeServer(handle: ServerHandle): void {
  assertServerHandle(handle);
  const addon = loadAddon();
  callNative(() => addon.finalizeServer(handle));
}

/// Events the server channel could not queue because its ring was full. A
/// non-zero count means a dispatch was lost to a stalled consumer; the
/// terminal reserve keeps close and shutdown events out of that set.
export function serverDroppedEvents(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverDroppedEvents(handle));
}

/// Inbound messages the engine parsed and then discarded because JavaScript had
/// not drained the inbound ring yet.
///
/// This is a loss, not a backpressure signal: the peer delivered the frame and
/// the engine framed it correctly, but there was nowhere to put the bytes. The
/// engine's WebSocket behavior exposes no way to stop reading once a consumer
/// falls behind, so the inbound ring is the only place a burst can be absorbed
/// and its depth is the budget. A non-zero count means a peer outran the main
/// thread and the application should be told rather than left to assume every
/// frame arrived.
export function serverDroppedMessages(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverDroppedMessages(handle));
}
