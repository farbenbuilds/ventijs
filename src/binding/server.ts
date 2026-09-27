import type { EngineDispatch, NativeEngineLimits, NativeServerConfig } from "./native";
import { callNative, guardError } from "./errors";
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
    throw guardError(
      `ventijs: server handle must be a uint40, got ${handle}`,
      "ERR_INVALID_HANDLE",
    );
  }
}

function assertConfigIntegers(config: NativeServerConfig): void {
  for (const field of INTEGER_CONFIG_FIELDS) {
    const value = config[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value)) {
      // An option value is not a handle, so it must not borrow the handle code.
      // A stable code that is semantically false is harder to branch on than a
      // message alone.
      throw guardError(
        `ventijs: server config "${field}" must be a safe integer, got ${value}`,
        "ERR_INVALID_OPTION",
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

/// Inbound messages the engine parsed and then discarded before JavaScript could
/// see them, from either of two causes.
///
/// This is a loss, not a backpressure signal: the peer delivered the frame and
/// the engine framed it correctly, but there was nowhere to put the bytes. The
/// engine's WebSocket behavior exposes no way to stop reading once a consumer
/// falls behind, so the inbound ring is the only place a burst can be absorbed
/// and its depth is the budget.
///
/// The second cause is a connection an application has paused. `ws.pause()`
/// pauses the socket so the bytes stay in the kernel receive buffer, and the
/// pinned engine has no per-connection read pause to do the same, so the frame is
/// discarded instead. A paused connection is bounded to itself; a full ring is
/// not. Both share this one counter because both are a peer outrunning the
/// consumer, which is what the number is for, and because neither is observable
/// from JavaScript otherwise.
///
/// A non-zero count means the application should be told rather than left to
/// assume every frame arrived.
export function serverDroppedMessages(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverDroppedMessages(handle));
}

/// Staged payloads the engine refused after the pump had taken them off the
/// outbound ring.
///
/// This is the outbound counterpart of `serverDroppedMessages`, and it exists
/// because the outbound path had no honest answer. `pumpSocket` returns `ok` once
/// the engine's inbox has accepted a payload, and the engine then discards it if
/// the connection's write queue is full, so a caller that watched only the status
/// saw success for bytes that were never sent. A non-zero count means exactly
/// that, and the app should be told rather than left to assume every frame
/// arrived.
export function serverUndeliveredMessages(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverUndeliveredMessages(handle));
}

/// The capacities the linked addon was compiled with.
///
/// Read from the addon rather than restated in TypeScript, because every one of
/// them is a promise the compatibility layer has to keep and a restated copy is
/// how the promise and the build drift apart. Nothing here is configurable at
/// runtime: the engine bakes these into its application type and refuses a
/// configuration that disagrees.
export function engineLimits(): NativeEngineLimits {
  return loadAddon().engineLimits();
}
