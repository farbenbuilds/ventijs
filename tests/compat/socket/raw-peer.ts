// A raw WebSocket peer, for the assertions a `ws` peer cannot make.
//
// Its own module because `ws` decompresses transparently and masks deliberately, so a
// round trip through it cannot show whether RSV1 was set, what a header said, or which
// close code a peer earned. Everything here reads the bytes.
//
// The client half of this peer is the minimum needed to open a connection: a socket, a
// request with the extension offered, and enough of a frame reader to take one frame
// apart. Sending a frame is in here too, because the RSV1 cases have to put a bit where
// `ws` will not.

import { connect, type Socket } from "node:net";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { read } from "./raw-reader";
import { request, UPGRADE_HEADERS } from "../server/upgrade-support";

/// One server-to-client frame, taken apart.
///
/// `inflated` is the payload after RFC 7692's inflate, and is the payload itself when
/// RSV1 was clear, so a test can assert on the message without branching on the flag.
export type ServerFrame = {
  readonly rsv1: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
  readonly inflated: Buffer;
};

export type RawHandshake = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly socket: Socket;
};

/// Completes an opening handshake offering `extension`, and hands the socket back so a
/// test can read the frames that follow the 101.
export async function offerExtension(port: number, extension: string): Promise<RawHandshake> {
  const socket = await dial(port);
  socket.write(request("/", { ...UPGRADE_HEADERS, "Sec-WebSocket-Extensions": extension }));
  const head = await readResponseHead(socket);
  return { status: statusOf(head), headers: headerMap(head), socket };
}

function dial(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => resolve(socket));
    socket.once("error", reject);
  });
}

function statusOf(head: string): number {
  const match = /^HTTP\/1\.1 (\d{3})\b/.exec(head);
  return match === null ? 0 : Number(match[1]);
}

/// Lowercased, so a test can name a header the way the protocol does without caring
/// which casing the server chose.
function headerMap(head: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of head.split("\r\n").slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}

/// The response head up to the blank line, as `latin1` so no byte is reinterpreted.
function readResponseHead(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk: Buffer): void => {
      data += chunk.toString("latin1");
      const end = data.indexOf("\r\n\r\n");
      if (end === -1) return;
      settle(() => resolve(data.slice(0, end)));
    };
    const onError = (error: Error): void => settle(() => reject(error));
    const settle = (done: () => void): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      done();
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.setTimeout(TEST_TIMEOUT_MS, () => onError(new Error("the response head never arrived")));
  });
}

/// Reads one frame from the server.
///
/// A server does not mask, so the length is a two-, eight- or ten-byte field and there
/// is no masking key to skip. The mask bit is not checked either: a server that masked
/// would be a protocol error, and a test asserting on RSV1 does not need to prove the
/// peer is well behaved.
export async function readFrame(socket: Socket): Promise<ServerFrame> {
  const head = await read(socket, 2);
  const rsv1 = ((head[0] as number) & 0x40) === 0x40;
  const opcode = (head[0] as number) & 0x0f;
  const short = (head[1] as number) & 0x7f;
  const length =
    short < 126
      ? short
      : short === 126
        ? (await read(socket, 2)).readUInt16BE(0)
        : Number((await read(socket, 8)).readBigUInt64BE(0));
  const payload = length === 0 ? Buffer.alloc(0) : await read(socket, length);
  return { rsv1, opcode, payload, inflated: rsv1 ? inflateRawSync(payload) : payload };
}

/// A masked client frame, because RFC 6455 section 5.1 requires one and a server closes
/// 1002 on an unmasked frame from a client.
///
/// The masking key is four zero bytes, which makes the payload the same bytes on the
/// wire, so a test can read what the frame carried rather than what it meant.
export function maskedFrame(opcode: number, payload: Buffer, rsv1 = false): Buffer {
  const mask = Buffer.alloc(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1)
    masked[i] = (masked[i] as number) ^ (mask[i & 3] as number);
  return Buffer.concat([
    Buffer.from([(rsv1 ? 0x40 : 0) | 0x80 | opcode, 0x80 | masked.length]),
    mask,
    masked,
  ]);
}

/// A complete, correctly framed compressed text message, as a peer that negotiated
/// nothing but set RSV1 anyway would send it.
export function compressedTextFrame(text: string): Buffer {
  return maskedFrame(0x1, deflateRawSync(Buffer.from(text)), true);
}
