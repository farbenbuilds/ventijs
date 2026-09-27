import { createCodec, destroyCodec } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { createError } from "../errors";

/// The codec a socket's frames are decoded and formatted with, or null before one
/// exists and after one is released.
export function codecOf(state: SocketState): bigint | null {
  return state.codec;
}

/// Opens the codec for a socket in the given role.
///
/// The role is the connection's, not a constant: RFC 6455 requires every frame
/// from a client to be masked and forbids a server from masking, so a codec built
/// the other way round refuses the one legal stream and accepts the illegal one. A
/// server socket opens `CODEC_ROLE.server` and a client socket
/// `CODEC_ROLE.client`, and the wrong choice is a connection that dies on its first
/// frame with a 1002 neither side expected.
export function openCodec(state: SocketState, role: number): bigint {
  if (state.codec !== null) return state.codec;
  const handle = createCodec(role);
  state.codec = handle;
  return handle;
}

/// Releases a socket's codec.
///
/// Idempotent, because both doors out of a socket reach it: a close handshake and a
/// transport that failed underneath. A double release would be a double free, and the
/// native side can only make it a no-op if the second call never happens.
export function closeCodec(state: SocketState): void {
  if (state.codec === null) return;
  destroyCodec(state.codec);
  state.codec = null;
}

/// Whether a socket is still worth writing to: open, and with a live transport.
export function isWritable(state: SocketState): boolean {
  return state.codec !== null && state.transport !== null && !state.transport.writableEnded;
}

/// A socket that has no transport cannot frame anything, which is a different fault
/// from a transport that has gone away and is worth a protocol error.
export function noTransportError(): Error {
  return createError("ERR_INVALID_STATE", "ventijs: the socket has no transport to write to");
}
