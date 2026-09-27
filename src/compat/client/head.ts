import type { Socket } from "node:net";

/// How much of a response head is kept before it must be complete. A legal response
/// is a status line, a handful of headers, and a blank line; 64 KiB is far more than
/// that and small enough that a peer cannot make this grow without bound.
export const MAX_HEADER_BYTES = 64 * 1024;

/// The blank line that ends a header block.
const HEADER_END = "\r\n\r\n";

/// Accumulates bytes until the header terminator, then reports everything read.
///
/// A response can be split across any number of reads, so this keeps accumulating. It
/// hands back the whole buffer rather than only the head, because the caller needs
/// both: `parseResponse` splits the head off, and a frame that shared the last read
/// with the 101 is in the bytes past it. A peer that greets with a frame in the same
/// segment is not unusual, and dropping those bytes would hang the connection.
export function readHead(
  socket: Socket,
  buffer: Buffer,
  onHead: (rest: Buffer) => void,
  onOversized: () => void,
): void {
  if (buffer.indexOf(HEADER_END) !== -1) {
    socket.off("data", onChunk);
    onHead(buffer);
    return;
  }
  if (buffer.length > MAX_HEADER_BYTES) {
    socket.off("data", onChunk);
    onOversized();
    return;
  }
  socket.on("data", onChunk);

  function onChunk(chunk: Buffer): void {
    const combined = Buffer.concat([buffer, chunk]);
    if (combined.length > MAX_HEADER_BYTES && combined.indexOf(HEADER_END) === -1) {
      socket.off("data", onChunk);
      onOversized();
      return;
    }
    readHead(socket, combined, onHead, onOversized);
  }
}
