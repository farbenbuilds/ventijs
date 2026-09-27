import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createError } from "../errors";
import type { ClientAddress } from "./address";

/// The transport the client will hand to the socket, which is the transport the
/// codec reads and writes.
///
/// A `net.Socket` and a `tls.TLSSocket` are both duplex streams, so the facade treats
/// them the same once they exist. Choosing between them is the only TLS decision the
/// client makes: `wss:` is `tls.connect`, everything else is `net.connect`, and
/// `ws` makes the same choice from the scheme.
export type ClientTransport = Socket;

/// Opens the transport for an address.
///
/// The `wss:` certificate is verified against Node's default CA set, exactly as
/// `ws` leaves it: a drop-in replacement that skipped verification would accept every
/// certificate an attacker's proxy presented, which is the one behaviour a caller
/// cannot detect from the outside.
export function openTransport(address: ClientAddress): ClientTransport {
  const target = { host: address.host, port: address.port };
  if (address.secure) {
    return tlsConnect({ ...target, servername: address.host });
  }
  return netConnect(target);
}

/// The error a connection failure reports, with the syscall code Node attached.
///
/// `ws` forwards the `net` error unchanged, and its `code` is what a caller switches
/// on to tell `ECONNREFUSED` from `ENOTFOUND`. Replacing it with a generic message
/// would make every one of those handlers unreachable.
export function connectionError(error: Error): Error {
  if (error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string") {
    return error;
  }
  return createError("ERR_PROTOCOL", `ventijs: the connection failed: ${String(error)}`);
}
