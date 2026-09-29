import type { EngineDispatch, NativeEngineLimits, NativeServerConfig } from "./native";
import { callNative, guardError } from "./errors";
import { loadAddon } from "./load";

export type ServerHandle = number;

/// The native side packs the slot byte and a 32 bit generation into a u40.
const MAX_SERVER_HANDLE = 2 ** 40 - 1;

/// napi-zig narrows JS numbers with `napi_get_value_int64`, which truncates fractions and
/// turns `NaN` into a different listener configuration.
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
      `ventiws: server handle must be a uint40, got ${handle}`,
      "ERR_INVALID_HANDLE",
    );
  }
}

function assertConfigIntegers(config: NativeServerConfig): void {
  for (const field of INTEGER_CONFIG_FIELDS) {
    const value = config[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value)) {
      // An option value is not a handle, so it must not borrow the handle code: a stable
      // code that is semantically false is harder to branch on than a message alone.
      throw guardError(
        `ventiws: server config "${field}" must be a safe integer, got ${value}`,
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

/// Releases native resources. Must run after `serverClosed` has been dispatched; finalizing
/// while events are queued throws `EventsPending` instead of freeing referenced memory.
export function finalizeServer(handle: ServerHandle): void {
  assertServerHandle(handle);
  const addon = loadAddon();
  callNative(() => addon.finalizeServer(handle));
}

/// Events the server channel could not queue because its ring was full. A non-zero count
/// means a dispatch was lost to a stalled consumer; the terminal reserve keeps close and
/// shutdown events out of that set.
export function serverDroppedEvents(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverDroppedEvents(handle));
}

/// A loss, not a backpressure signal: the peer delivered the frame and the engine framed
/// it correctly, but there was nowhere to put the bytes. The engine exposes no way to stop
/// reading once a consumer falls behind, so the inbound ring is the only place a burst can
/// be absorbed. The other cause is a paused connection the pinned engine cannot backpressure:
/// `ws.pause()` leaves the bytes in the kernel receive buffer and the frame is discarded.
/// Both are a peer outrunning the consumer, which is why one counter holds both.
export function serverDroppedMessages(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverDroppedMessages(handle));
}

/// The outbound counterpart of `serverDroppedMessages`. `pumpSocket` returns `ok` once the
/// engine's inbox has accepted a payload, and the engine discards it if the connection's
/// write queue is full, so a status-only caller saw success for bytes that were never sent.
export function serverUndeliveredMessages(handle: ServerHandle): bigint {
  assertServerHandle(handle);
  const addon = loadAddon();
  return callNative(() => addon.serverUndeliveredMessages(handle));
}

/// Read from the addon rather than restated in TypeScript: a restated copy is how the
/// promise and the build drift apart. Nothing here is a runtime option, because the engine
/// bakes these into its application type and refuses a configuration that disagrees.
export function engineLimits(): NativeEngineLimits {
  return loadAddon().engineLimits();
}
