/// The outbound half of the codec boundary: format a frame, read it back. Everything
/// here copies out of engine memory and nothing takes bytes in, so there is no untrusted
/// argument to validate on this side.

import { callNative, nativeError } from "./errors";
import { loadAddon } from "./load";

/// The framed length is returned so the caller can allocate before copying, which keeps the
/// header arithmetic out of TypeScript: nothing here knows how many bytes a header takes for
/// a given payload. `mask` is the caller's own key, or empty to let the engine draw one, and
/// is read only when `maskFrame` is set; a server never masks either way.
export function encodeCodecFrame(
  handle: bigint,
  kind: number,
  fin: boolean,
  payload: Uint8Array,
  compress: boolean,
  maskFrame = true,
  mask: Uint8Array = EMPTY,
): number {
  const addon = loadAddon();
  return callNative(() =>
    addon.codecEncode(
      handle,
      kind,
      fin ? 1 : 0,
      payload,
      compress ? 1 : 0,
      maskFrame ? 1 : 0,
      mask,
    ),
  );
}

const EMPTY = new Uint8Array(0);

/// One frame formatted into a Node-owned `Buffer` in one crossing, or a negative
/// encode-failure ordinal. Arguments are `encodeCodecFrame`'s, and the caller writes the
/// returned buffer whole: there is no length to slice by.
export function writeCodecFrame(
  handle: bigint,
  kind: number,
  fin: boolean,
  payload: Uint8Array,
  compress: boolean,
  maskFrame = true,
  mask: Uint8Array = EMPTY,
): Buffer | number {
  const addon = loadAddon();
  try {
    return addon.codecWrite(
      handle,
      kind,
      fin ? 1 : 0,
      payload,
      compress ? 1 : 0,
      maskFrame ? 1 : 0,
      mask,
    );
  } catch (error) {
    throw nativeError(error);
  }
}

/// Formats only the header for a payload the caller writes as its own chunk, the writev
/// shape `ws` uses. The caller sizes `out` to the physical header and writes it whole.
export function writeCodecHeader(
  handle: bigint,
  kind: number,
  fin: boolean,
  payloadLength: number,
  maskFrame: boolean,
  mask: Uint8Array,
  out: Uint8Array,
): number {
  const addon = loadAddon();
  try {
    return addon.codecHeader(
      handle,
      kind,
      fin ? 1 : 0,
      payloadLength,
      maskFrame ? 1 : 0,
      mask,
      out,
    );
  } catch (error) {
    throw nativeError(error);
  }
}

export function codecOutbound(handle: bigint): Buffer {
  const addon = loadAddon();
  return callNative(() => addon.codecOutbound(handle));
}

/// Lets a caller assert the role was honoured without parsing a header.
export function codecOutboundMasked(handle: bigint): boolean {
  const addon = loadAddon();
  return callNative(() => addon.codecOutboundMasked(handle));
}
