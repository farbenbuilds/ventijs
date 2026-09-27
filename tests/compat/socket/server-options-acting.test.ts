//! Server options that were normalized, reported on `server.options`, and then never
//! acted on.
//!
//! Each case here is a knob a caller set and watched nothing happen. `autoPong` was
//! the sharpest: a test claimed to cover it, set `autoPong: false`, and asserted that
//! the *server* socket received no pong — which is true whether or not the option is
//! honoured, because the automatic pong goes to the client. The test passed with the
//! bug and would have passed with the bug fixed, which is the only kind of test worse
//! than no test.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openRawClient } from "../../binding/codec-net";
import { openClient, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// An option `ws` accepts at runtime and `@types/ws` does not declare.
///
/// `closeTimeout`, `maxBufferedChunks`, `maxFragments`, and `skipUTF8Validation` are
/// all missing from the pinned declaration file, so a TypeScript caller is refused by
/// `ws` for the same reason and has to cast. The cast is what a JavaScript caller does
/// implicitly, and keeping it in one place means the suite is not quietly testing a
/// different configuration from the one a real caller would end up with.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// The same cast in the reading direction, for the properties `@types/ws` omits.
function reported(options: unknown): Record<string, unknown> {
  return options as Record<string, unknown>;
}

/// A ping sent by the peer, and whether the automatic pong came back.
///
/// Observed on the *client*, and driven from the *client*, because that is the only
/// pairing that works: RFC 6455 section 5.5.2 requires the pong to go back to whoever
/// sent the ping, so a server-initiated ping is answered by the client and neither end
/// sees a `pong` event for it. A test that pinged from the server and watched the
/// server's own `pong` list was watching the wrong end of the exchange, which is how
/// `autoPong: false` passed while the option did nothing.
async function answered(server: WebSocketServer): Promise<boolean> {
  const harness = await upgradeHarness(server);
  const accepted = new Promise<WebSocket>((resolve) => {
    server.once("connection", resolve);
  });
  const client = await openClient(harness.url);
  try {
    await accepted;
    const pongs: Buffer[] = [];
    client.on("pong", (data: Buffer) => pongs.push(data));
    client.ping(Buffer.from("hi"));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    return pongs.length > 0;
  } finally {
    client.terminate();
    await harness.close();
  }
}

test("autoPong true answers a ping", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true, autoPong: true });
  try {
    expect(await answered(server)).toBe(true);
  } finally {
    server.close();
  }
});

test("autoPong false suppresses the automatic pong", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, autoPong: false }));
  try {
    // An application that answers pings itself must not also get the library's answer,
    // or its peer sees two pongs for one ping.
    expect(await answered(server)).toBe(false);
  } finally {
    server.close();
  }
});

/// The default is still on, and `server.options` still reports the `ws` defaults.
test("the ws defaults are still reported", () => {
  const server = new WebSocketServer({ noServer: true });
  try {
    const options = reported(server.options);
    expect("clients" in server).toBe(true);
    expect(options.maxBufferedChunks).toBe(262144);
    expect(options.maxFragments).toBe(16384);
    expect(options.maxPayload).toBe(104857600);
    expect(options.closeTimeout).toBe(30000);
  } finally {
    server.close();
  }
});

/// `closeTimeout: 0` tears the socket down, which is what `setTimeout(fn, 0)` does in
/// `ws` and what a caller who wrote it asked for.
///
/// It was read as "no deadline", so the socket sat at `CLOSING` forever holding its
/// transport and its codec slot while `ws` reported a clean 1006 milliseconds later.
test("closeTimeout zero is a deadline, not an absence", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, closeTimeout: 0 }));
  const harness = await upgradeHarness(server);
  const accepted = new Promise<WebSocket>((resolve) => {
    server.once("connection", resolve);
  });
  // A raw peer, because a conforming one answers the close frame and the handshake
  // finishes before the deadline is the thing under test. This one reads the request,
  // never writes a close back, and so is the hung peer `closeTimeout` exists for.
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const closed = new Promise<number>((resolve) => {
      socket.on("close", (code: number) => resolve(code));
    });
    socket.close();
    // 1006, not 1005: a close the peer never answered leaves nothing received.
    expect(await closed).toBe(1006);
    await waitFor(() => socket.readyState === WebSocket.CLOSED);
  } finally {
    raw.destroy();
    await harness.close();
  }
});
