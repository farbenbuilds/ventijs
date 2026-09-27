//! A peer that completes the handshake and then says nothing useful.
//!
//! Its own module because the interesting cases are the ones `ws` will not do: a 101
//! with no subprotocol after one was requested, a 101 with a wrong accept digest, a
//! response that is not a 101 at all. A conforming server is what the other suite
//! uses; this is what a hostile or broken one looks like.

import { createServer, type Server, type Socket } from "node:net";
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type RawPeer = {
  readonly url: string;
  close(): Promise<void>;
};

/// A listener that answers 101 with the headers given, and nothing else.
///
/// `overrides` replaces any header, which is how a wrong digest or an unsolicited
/// extension is expressed without a second listener.
export async function rawAcceptServer(
  overrides: Readonly<Record<string, string>> = {},
  status = "101 Switching Protocols",
): Promise<RawPeer> {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let answered = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      // Once, and only to the opening request. A second response would be a peer
      // speaking HTTP in the middle of a WebSocket connection, which is a protocol
      // error the client is right to refuse, and it would hide whatever this peer was
      // built to test.
      if (answered) return;
      buffered = Buffer.concat([buffered, chunk as Buffer]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      answered = true;
      const key = /sec-websocket-key: (.+)\r\n/i.exec(
        buffered.subarray(0, end).toString("latin1"),
      )?.[1];
      if (key === undefined) return;
      const accept = createHash("sha1")
        .update(key + GUID)
        .digest("base64");
      const headers: Record<string, string> = {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Accept": accept,
        ...overrides,
      };
      const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
      socket.write(`HTTP/1.1 ${status}\r\n${lines.join("\r\n")}\r\n\r\n`);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
