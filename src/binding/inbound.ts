import { callNative } from "./errors";
import { assertServerHandle, type ServerHandle } from "./server";
import { loadAddon } from "./load";
import { assertConnectionHandle, type ConnectionHandle } from "./handle";

/// The inbound half of the per-connection surface. Both are consumers of the same
/// single-consumer FIFO, which is the constraint that shapes the purge.

/// The engine reuses its message buffer and frees the ring slot here, so the returned buffer
/// is the only copy and is safe to retain past the handler.
export function takeSocketMessage(
  server: ServerHandle,
  connection: ConnectionHandle,
): { readonly bytes: Buffer; readonly isBinary: boolean } | null {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  const taken = callNative(() => addon.takeSocketMessage(server, connection));
  if (taken === null) return null;
  return { bytes: taken[0], isBinary: taken[1] };
}

/// A connection closing with messages still staged leaves records no consumer can match, and a
/// stranded head makes every other connection's next take fail too.

// The index and generation come from `connection_close`, not a handle, which is already stale;
// the native side refuses any pair the slab calls live, so no live connection loses messages.
export function purgeSocketMessage(
  server: ServerHandle,
  index: number,
  generation: number,
): number {
  assertServerHandle(server);
  const addon = loadAddon();
  return Number(callNative(() => addon.purgeSocketMessage(server, index, generation)));
}
