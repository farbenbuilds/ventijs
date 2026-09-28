import { createCodec, destroyCodec } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { createError } from "../errors";

export function codecOf(state: SocketState): bigint | null {
  return state.codec;
}

/// The role is the connection's, not a constant: RFC 6455 requires every frame from a client to
/// be masked and forbids a server from masking, so a codec built the other way round refuses
/// the one legal stream and dies on the first frame with an unexpected 1002.

// The UTF-8 policy and the two ceilings ride along because a codec is one connection, so there
// is no later call in which to change them, and a socket is `CONNECTING` past its options.
export function openCodec(state: SocketState, role: number): bigint {
  if (state.codec !== null) return state.codec;
  const handle = createCodec(role, {
    maxPayload: state.maxPayload,
    maxFragments: state.maxFragments,
    validateUtf8: state.validateUtf8,
    permessageDeflate: state.compressible,
  });
  state.codec = handle;
  return handle;
}

/// Idempotent: both doors out of a socket reach it, and a double release is a double free.
export function closeCodec(state: SocketState): void {
  if (state.codec === null) return;
  destroyCodec(state.codec);
  state.codec = null;
}

export function isWritable(state: SocketState): boolean {
  return state.codec !== null && state.transport !== null && !state.transport.writableEnded;
}

/// A socket that cannot frame at all is a different fault from a transport that went away.
export function noTransportError(): Error {
  return createError("ERR_INVALID_STATE", "ventijs: the socket has no transport to write to");
}
