import type { ClientOptions, ServerOptions, WebSocket } from "../../types/ws";
import { createSocketState } from "./state";
import { buildSocketRecord } from "./record";
import { connectSocket } from "../client/connect";

export { isSocket } from "./state";

/// Builds the `ws`-shaped socket for an address.
///
/// A `null` address is the server-side socket the upgrade path adopts, exactly like
/// `new WebSocket(null)`. Anything else is a client address, and the client owns the
/// handshake because it owns the transport: the connection does not exist until the
/// socket is open, so a caller that needs to fail early gets a throw rather than a
/// socket that fails later.
export function createSocket(
  address: string | URL | null,
  protocols?: string | string[] | undefined,
  options?: ClientOptions | ServerOptions | undefined,
): WebSocket {
  if (address === null) return buildSocketRecord(createSocketState());
  return connectSocket(address, protocols, options);
}
