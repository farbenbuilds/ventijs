//! A peer that answers an opening request with something other than a handshake.
//!
//! A `node:http` server is the wrong fixture here, and the reason is worth stating: a
//! WebSocket handshake arrives on its `upgrade` event, not its `request` event, so an
//! HTTP server never sees the request this is about. This is a raw listener answering
//! one request per connection, which is what a redirect actually looks like on the wire
//! and what a load balancer or a CDN in front of a socket endpoint produces.

import { createServer, type Server, type Socket } from "node:net";
import { acceptValue } from "../../binding/codec-net";

/// The token a script uses to mean "this peer's own authority", which a self-redirect
/// needs because the port is not known until the peer is listening.
const SELF = "self";

export type RedirectPeer = {
  readonly url: string;
  /// The `Authorization` header of each request the peer received, in order, so a test
  /// can say whether credentials survived a hop.
  readonly authorizations: Array<string | undefined>;
  close(): Promise<void>;
};

export type PeerScript = {
  /// The status for the first request. A 3xx answers with `location`; anything else
  /// answers with an empty body, which is what a non-WebSocket server does.
  readonly first: number;
  /// Where a 3xx points. Omitted means the first request is not a redirect.
  readonly location?: string;
  /// The status for every request after the first. A 101 completes the handshake, which
  /// is what the redirect cases need to reach an open socket.
  /// The status for a request after the first. Named `after` rather than `then` because a
  /// field called `then` makes the object a thenable to any linter that reads it.
  readonly after: number;
};

/// A peer that answers according to `script`, one request per connection.
export function scriptedPeer(script: PeerScript): Promise<RedirectPeer> {
  const authorizations: Array<string | undefined> = [];
  const sockets: Socket[] = [];
  let served = 0;
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    socket.on("error", () => undefined);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      const head = buffered.subarray(0, end).toString("latin1");
      // The head stops before the blank line, so the last header has no trailing CRLF
      // and a pattern that requires one would miss exactly the header that is last.
      authorizations.push(/^authorization: (.*)$/im.exec(head)?.[1]?.trim());
      served += 1;
      const status = served === 1 ? script.first : script.after;
      if (status >= 300 && status < 400 && script.location !== undefined) {
        // A `SELF` location is resolved here rather than at the call site because the
        // port does not exist until the peer is listening.
        const authority = (server.address() as { port: number }).port;
        const target = script.location.startsWith(SELF)
          ? `ws://127.0.0.1:${authority}${script.location.slice(SELF.length)}`
          : script.location;
        socket.write(
          `HTTP/1.1 ${status} Found\r\nLocation: ${target}\r\nContent-Length: 0\r\n\r\n`,
        );
        return;
      }
      if (status !== 101) {
        socket.write(`HTTP/1.1 ${status} Not A Handshake\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      const key = /sec-websocket-key: (.+)\r\n/i.exec(head)?.[1]?.trim() ?? "";
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${acceptValue(key)}`,
          "",
          "",
        ].join("\r\n"),
      );
    };
    socket.on("data", onData);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
        authorizations,
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

/// A peer that completes a handshake, and is the destination of a redirect.
export function handshakePeer(): Promise<RedirectPeer> {
  return scriptedPeer({ first: 101, after: 101 });
}

/// A peer that answers the first request with a redirect and completes the next.
export function redirectingPeer(location: string): Promise<RedirectPeer> {
  return scriptedPeer({ first: 302, location, after: 101 });
}

/// A peer that redirects to itself, which is the one case where a redirect keeps its
/// host *and* its port, and so the one case where credentials survive the hop.
export function selfRedirectPeer(path: string): Promise<RedirectPeer> {
  return scriptedPeer({ first: 302, location: `${SELF}${path}`, after: 101 });
}
