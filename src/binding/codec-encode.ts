//! The outbound half of the codec boundary: format a frame, read it back.
//!
//! Split from `codec.ts` because the two directions have nothing in common but the
//! handle, and the module budget is what made the split necessary rather than
//! stylistic. Everything here copies out of engine memory; nothing here takes bytes
//! in, so there is no untrusted argument to validate on this side.

import { callNative } from "./errors";
import { loadAddon } from "./load";

/// Formats one frame, reporting its framed length.
///
/// The framed length is returned so the caller can allocate before copying, which
/// is what keeps the header arithmetic out of TypeScript: nothing here knows how
/// many bytes a header takes for a given payload.
export function encodeCodecFrame(
  handle: bigint,
  kind: number,
  fin: boolean,
  payload: Uint8Array,
  compress: boolean,
): number {
  const addon = loadAddon();
  return callNative(() => addon.codecEncode(handle, kind, fin ? 1 : 0, payload, compress ? 1 : 0));
}

/// The framed bytes waiting to be copied out, as a Node-owned buffer.
export function codecOutbound(handle: bigint): Buffer {
  const addon = loadAddon();
  return callNative(() => addon.codecOutbound(handle));
}

/// Whether the last encoded frame was masked, so a caller can assert the role was
/// honoured without parsing a header.
export function codecOutboundMasked(handle: bigint): boolean {
  const addon = loadAddon();
  return callNative(() => addon.codecOutboundMasked(handle));
}

/// The close code a refused frame maps to, or 0 while the connection is healthy.
export function codecFailureCode(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecFailureCode(handle));
}

/// Drops every buffered byte and event, for a connection abandoned early.
export function resetCodec(handle: bigint): void {
  const addon = loadAddon();
  callNative(() => addon.codecReset(handle));
}

/// The role a codec was created for, or -1 once it has been released.
export function codecRole(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecRole(handle));
}
