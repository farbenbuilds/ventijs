import type { SocketState } from "../../types/socket";

/// The bytes this socket has handed to its transport and not yet had written.
///
/// `ws` reports its sender's queue length, and a transport's is the same number: the
/// frames accepted and not yet flushed. `writableLength` is that length, and it is the
/// one property on a Node stream that means "waiting to go out".
///
/// A `DESTROYED` stream reports zero, which is right: there is nothing queued for a
/// socket that will never write again. Reading it on a closed socket is harmless and
/// keeps the caller from having to know that.
export function queuedBytes(state: SocketState): number {
  if (state.transport === null) return 0;
  return state.transport.writableLength;
}
