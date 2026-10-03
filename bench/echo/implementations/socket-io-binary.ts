export const ECHO_EVENT = "echo";

/// Engine.IO hands binary attachments through as Buffer in Node, but a JSON
/// packet or a browser-shaped client can deliver an ArrayBuffer or a view;
/// anything else is rejected by the caller rather than coerced.
export const toBinaryBuffer = (payload: unknown): Buffer | null => {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  return null;
};
