//! A TLS peer whose only job is to answer one opening request with a redirect.
//!
//! Its own module because `redirect-peer.ts` is a plain `node:net` listener and a
//! downgrade is the one redirect that has to arrive over TLS: the point is the `wss:`
//! hop, so the first listener has to speak `wss:` for the refusal to be the one under
//! test rather than a certificate error.

import { createServer, type Server, type TLSSocket } from "node:tls";
import { certificates } from "./tls-support";

export type DowngradePeer = {
  /// `wss://localhost:<port>`: the minted certificate carries `DNS:localhost` and no
  /// IP literal, so the address a client dials has to be the name in it.
  readonly url: string;
  close(): Promise<void>;
};

/// Answers the first request with `302` naming `target`, and nothing else: the peer a
/// downgrade lands on is an ordinary `ws:` peer and has its own fixture.
export function downgradePeer(target: string): Promise<DowngradePeer> {
  const { key, cert } = certificates();
  const sockets: TLSSocket[] = [];
  const server: Server = createServer({ key, cert }, (socket: TLSSocket) => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let answered = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (answered) return;
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.indexOf("\r\n\r\n") === -1) return;
      answered = true;
      socket.write(
        ["HTTP/1.1 302 Found", `Location: ${target}`, "Content-Length: 0", "", ""].join("\r\n"),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `wss://localhost:${port}/`,
        close: () => {
          for (const socket of sockets) socket.destroy();
          return new Promise<void>((done) => {
            server.close(() => done());
          });
        },
      });
    });
  });
}
