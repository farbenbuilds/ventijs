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
  /// The request target of each request, in order. Two hops are otherwise
  /// indistinguishable here, and "did the second request actually go out, and where" is
  /// what a redirect listener is for.
  readonly paths: string[];
  /// The `x-ventiws-hop` header of each request, in order, for the same reason: a caller
  /// that sets a header on a redirected request can only prove it took effect by having
  /// the peer report what arrived.
  readonly markers: Array<string | undefined>;
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
  const paths: string[] = [];
  const markers: Array<string | undefined> = [];
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
      markers.push(/^x-ventiws-hop: (.*)$/im.exec(head)?.[1]?.trim());
      paths.push(/^\S+ (\S+) HTTP\/1\.1$/im.exec(head)?.[1] ?? "");
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
        // A body and a header of its own, because the two are what a caller reading a
        // refusal through `unexpected-response` is actually handed: the response is a
        // live `IncomingMessage`, so its headers and its body are both readable, and a
        // peer that sent neither would make a test pass without proving that.
        const body = `token required\n`;
        socket.write(
          [
            `HTTP/1.1 ${status} Not A Handshake`,
            "X-Peek: refused-by-peer",
            "Content-Type: text/plain",
            `Content-Length: ${Buffer.byteLength(body)}`,
            "",
            body,
          ].join("\r\n"),
        );
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
        paths,
        markers,
        close: () => {
          // Destroyed mid-handshake sockets report `ECONNRESET`, and the peer's listener
          // is the only one that will ever see it. A test that leaves one off sees the
          // error as an unhandled rejection against whichever test happened to be running.
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
