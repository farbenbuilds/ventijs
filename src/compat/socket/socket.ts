import type { ClientOptions, ServerOptions, WebSocket } from "../../types/ws";
import { promoteOptions } from "../client/protocols";
import { createSocketState } from "./state";
import { buildSocketRecord } from "./record";
import { connectSocket } from "../client/connect";

export { isSocket } from "./state";

/// A `null` address is the server-side socket the upgrade path adopts, exactly like
/// `new WebSocket(null)`. Anything else is a client address, and the client owns the
/// handshake because it owns the transport, so a caller that needs to fail early gets a
/// throw rather than a socket that fails later.
export function createSocket(
  address: string | URL | null,
  protocols?: string | string[] | undefined,
  options?: ClientOptions | ServerOptions | undefined,
): WebSocket {
  if (address === null) return buildSocketRecord(createSocketState());
  const promoted = promoteOptions(protocols, options as ClientOptions | undefined);
  return connectSocket(
    address,
    promoted.protocols,
    promoted.options as ClientOptions | ServerOptions | undefined,
  );
}
