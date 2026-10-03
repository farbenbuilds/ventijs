import { CODEC_KINDS, type CodecKindName } from "../../binding/codec";
import { writeCodecFrame, writeCodecHeader } from "../../binding/codec-encode";
import type { SocketState } from "../../types/socket";
import { isWritable } from "./codec-handle";
import { encodeFailure, type FrameStatus } from "./frame-status";

/// What framing one frame did, in the vocabulary the send path already switches on.
export type { FrameStatus, FailureStatus } from "./frame-status";
export { frameError, isTransient } from "./frame-status";

function ordinalOf(kind: CodecKindName): number {
  return CODEC_KINDS.indexOf(kind);
}

/// The caller's own masking key, or empty for the engine to draw one. Reused rather than
/// allocated per frame, because `generateMask` runs before every masked frame.
///
/// A server never masks, so `isServer` answers before the callback is asked, as in `ws`; that
/// refusal is deliberate and documented. Honouring `mask: false` on a client is not, because a
/// caller who asked for an unmasked frame was given a masked one and nothing said so.
function maskFor(state: SocketState, mask: boolean): Uint8Array {
  if (state.isServer || !mask || state.generateMask === null) return NO_MASK;
  state.generateMask(state.maskScratch);
  return state.maskScratch;
}

const NO_MASK = new Uint8Array(0);

/// RFC 6455 section 5.2 wire opcodes; `CODEC_KINDS` ordinals are the ABI, not the wire.
const WIRE_OPCODES: Readonly<Record<CodecKindName, number>> = {
  continuation: 0,
  text: 1,
  binary: 2,
  close: 8,
  ping: 9,
  pong: 10,
  rejected: 0,
};

const CONTROL_KINDS: ReadonlySet<CodecKindName> = new Set(["close", "ping", "pong"]);

/// A small unmasked frame's header is two octets, so it is written here rather than in a
/// crossing. Everything else (extended lengths, masking, compression) goes to the codec.
function smallHeader(kind: CodecKindName, fin: boolean, length: number): Buffer | null {
  if (length >= 126) return null;
  if (CONTROL_KINDS.has(kind) && (!fin || length > 125)) return null;
  const header = Buffer.allocUnsafe(2);
  header[0] = (fin ? 0x80 : 0) | WIRE_OPCODES[kind];
  header[1] = length;
  return header;
}

/// Frames one message and writes it. A server does not mask, so the role is decided by
/// the codec rather than the caller: a masked frame from a server is a protocol error a
/// peer may close on, and the only way not to send one is not to offer the choice.

// `fin` and `compress` are the caller's because a fragmented send is two calls and RSV1
// is a per-frame decision. RFC 7692 only allows RSV1 on the first frame of a data
// message, and a control frame or continuation asking for it is refused with 1002.
export function writeFrame(
  state: SocketState,
  kind: CodecKindName,
  payload: Buffer,
  fin = true,
  compress = false,
  mask = true,
): FrameStatus {
  const handle = state.codec;
  if (handle === null) return "closed";
  if (!isWritable(state)) return state.transport?.writableEnded === true ? "closed" : "closing";
  const ordinal = ordinalOf(kind);
  // Uncompressed unmasked frames take the writev shape: the header is a few bytes and the
  // payload goes out as its own chunk, so no frame-sized buffer is allocated or copied per
  // message. A masked frame stays on the fused path, where the codec masks the payload.
  if (!compress && (state.isServer || !mask)) {
    const header = smallHeader(kind, fin, payload.byteLength);
    if (header !== null) {
      if (state.transport === null) return "closed";
      state.transport.cork();
      state.transport.write(header);
      state.transport.write(payload);
      state.transport.uncork();
      return "ok";
    }
    const out = Buffer.allocUnsafe(headerSize(payload.byteLength, false));
    const written = writeCodecHeader(handle, ordinal, fin, payload.byteLength, mask, NO_MASK, out);
    if (written < 0) return encodeFailure(-written);
    if (state.transport === null) return "closed";
    state.transport.cork();
    state.transport.write(out);
    state.transport.write(payload);
    state.transport.uncork();
    return "ok";
  }
  const framed = writeCodecFrame(
    handle,
    ordinal,
    fin,
    payload,
    compress,
    mask,
    maskFor(state, mask),
  );
  if (typeof framed === "number") return encodeFailure(-framed);
  if (state.transport === null) return "closed";
  state.transport.write(framed);
  return "ok";
}

/// The physical header size for an uncompressed frame: two base octets, a 16-bit length
/// for 126 bytes and up, an eight-octet length for 64 KiB and up, and the masking key.
function headerSize(payloadLength: number, masked: boolean): number {
  const extended = payloadLength < 126 ? 0 : payloadLength < 65536 ? 2 : 8;
  return 2 + extended + (masked ? 4 : 0);
}

/// A pong is not optional: RFC 6455 section 5.5.2 requires one, promptly.
export function writePong(state: SocketState, payload: Buffer): void {
  writeFrame(state, "pong", payload);
}

/// An absent `code` writes the *empty* close payload, which is what a peer reads as "no
/// status". Substituting 1000 claimed a shutdown the caller never stated and made 1005
/// unobservable from a ventiws peer.
export function writeCloseFrame(
  state: SocketState,
  code: number | undefined,
  reason: Buffer,
): void {
  if (state.closeFrameSent) return;
  const frame = closePayload(code, reason);
  if (writeFrame(state, "close", frame) !== "ok") return;
  state.closeFrameSent = true;
}

function closePayload(code: number | undefined, reason: Buffer): Buffer {
  if (code === undefined) return Buffer.alloc(0);
  const payload = Buffer.alloc(2 + reason.length);
  payload.writeUInt16BE(code, 0);
  reason.copy(payload, 2);
  return payload;
}
