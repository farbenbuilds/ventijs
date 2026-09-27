import { callNative } from "./errors";
import { assertServerHandle, type ServerHandle } from "./server";
import { loadAddon } from "./load";
import { assertConnectionHandle, type ConnectionHandle } from "./handle";

/// The inbound half of the per-connection surface: taking a parsed message out
/// of the engine, and reclaiming the ring space a departed connection leaves
/// behind. Both are Node main thread only, and both are consumers of the same
/// single-consumer FIFO, which is the constraint that shapes the purge.

/// One parsed inbound message, copied into a Node-owned buffer.
///
/// The engine reuses its own message buffer for the next frame and frees the
/// ring slot here, so the returned buffer is the only copy and is safe to retain
/// past the handler. Null means nothing is staged, which happens when a wakeup
/// was coalesced or the event channel dropped its notification.
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

/// Drops the staged inbound messages of a connection that has closed.
///
/// The inbound ring is one strictly ordered FIFO shared by every connection on
/// the server, and a consumer may only skip a head it does not own. A connection
/// that closes with messages still staged therefore leaves records no consumer
/// can ever match, and a stranded head makes every other connection's next take
/// fail too. Purging on the close event is what stops one departed peer from
/// leaving the rest of the server permanently unable to receive a message.
///
/// The index and generation come from the `connection_close` event rather than a
/// connection handle, because the handle is already stale by then. The native
/// side refuses any pair the slab still considers live, so this cannot drop a
/// live connection's messages. The drops are added to the same counter as a
/// refused stage, so `serverDroppedMessages` remains the single inbound-loss
/// number.
export function purgeSocketMessage(
  server: ServerHandle,
  index: number,
  generation: number,
): number {
  assertServerHandle(server);
  const addon = loadAddon();
  return Number(callNative(() => addon.purgeSocketMessage(server, index, generation)));
}
