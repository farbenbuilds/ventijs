// What a redirect may carry to another origin.
//
// Its own file because it is a security question rather than a routing one. A
// redirect is under the control of whatever answered, so a `Location` naming another
// host must not deliver the credentials the first host was given, and a redirect
// within one host must, because a caller who authenticated expects to still be
// authenticated when the same server sends them elsewhere on itself.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { handshakePeer, redirectingPeer, selfRedirectPeer } from "./redirect-peer";
import { undeclared } from "./undeclared";

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

test(
  "credentials do not survive a redirect to another host",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The security property, and why it is worth a test: a redirect is under the control
    // of whatever answered, so a `Location` naming another host must not deliver the
    // caller's credentials to it.
    const final = await handshakePeer();
    const first = await redirectingPeer(final.url);
    // Credentials in the URL become an `Authorization` header on the first hop, which is
    // the form a redirect has to be careful with.
    const port = new URL(first.url).port;
    const socket = new WebSocket(
      `ws://user:pass@127.0.0.1:${port}`,
      undefined,
      undeclared({ followRedirects: true }),
    );
    try {
      await opened(socket);
      // The first hop carried them and the second did not.
      expect(first.authorizations[0]).toBe("Basic dXNlcjpwYXNz");
      expect(final.authorizations[0]).toBeUndefined();
    } finally {
      socket.terminate();
      await first.close();
      await final.close();
    }
  },
);

test("credentials survive a redirect to the same host", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The complement of the case above, because dropping them unconditionally would be
  // just as wrong as never dropping them: a redirect within one host is the same
  // origin, and a caller who authenticated expects to still be authenticated.
  const peer = await selfRedirectPeer("/same-host-path");
  const port = new URL(peer.url).port;
  const socket = new WebSocket(
    `ws://user:pass@127.0.0.1:${port}`,
    undefined,
    undeclared({ followRedirects: true }),
  );
  try {
    await opened(socket);
    // Both hops went to the same host and port, so both carried the credentials.
    expect(peer.authorizations).toEqual(["Basic dXNlcjpwYXNz", "Basic dXNlcjpwYXNz"]);
  } finally {
    socket.terminate();
    await peer.close();
  }
});
