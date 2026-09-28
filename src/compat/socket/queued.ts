import type { SocketState } from "../../types/socket";

/// `ws` reports its sender's queue length, and a transport's is the same number:
/// `writableLength` is the one property on a Node stream that means "waiting to go out".
/// A `DESTROYED` stream reports zero, which is right for a socket that will never write
/// again, so reading it on a closed socket is harmless.
export function queuedBytes(state: SocketState): number {
  if (state.transport === null) return 0;
  return state.transport.writableLength;
}
