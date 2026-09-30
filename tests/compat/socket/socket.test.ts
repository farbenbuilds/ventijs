import { expect, test } from "vitest";
import { closeFrameWritten } from "../../../src/compat/socket/lifecycle";
import { createWebSocketStream } from "../../../src/compat/stream";
import { WebSocket, WebSocketServer } from "../../../src/index";
import type { CodedError } from "../../../src/types/errors";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { attached, terminateClient } from "./socket-support";

const MAX_MESSAGE_BYTES = 32 * 1024;

test("the constructor passes instanceof and carries the ready-state constants", () => {
  const socket = new WebSocket(null);
  expect(socket).toBeInstanceOf(WebSocket);
  expect(socket.CONNECTING).toBe(0);
  expect(socket.OPEN).toBe(1);
  expect(socket.CLOSING).toBe(2);
  expect(socket.CLOSED).toBe(3);
  expect(WebSocket.CONNECTING).toBe(0);
  expect(WebSocket.CLOSED).toBe(3);
  expect(WebSocket.WebSocket).toBe(WebSocket);
  expect(WebSocket.WebSocketServer).toBe(WebSocketServer);
  expect(WebSocket.Server).toBe(WebSocketServer);
  expect(WebSocket.createWebSocketStream).toBe(createWebSocketStream);
});

/// A bad address is a programming error, so it throws from the constructor rather
/// than arriving later as an `error` on a socket the caller already holds.
test("an invalid client address throws from the constructor", () => {
  expect(() => new WebSocket("not a url")).toThrow(SyntaxError);
  expect(() => new WebSocket("ftp://127.0.0.1/")).toThrow(/protocol must be one of/);
  expect(() => new WebSocket("ws://127.0.0.1/#fragment")).toThrow(/fragment identifier/);
  expect(() => new WebSocket("ws://127.0.0.1/", ["bad protocol"])).toThrow(
    /invalid or duplicated subprotocol/,
  );
});

test(
  "attaching a native connection opens the socket and routes sends",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      expect(socket.readyState).toBe(socket.OPEN);
      expect(socket.bufferedAmount).toBe(0);
      await new Promise<void>((resolve, reject) => {
        socket.send("hello", (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      expect(socket.bufferedAmount).toBe(5);
      socket.send(Buffer.from([1, 2, 3]), { binary: true });
      expect(socket.bufferedAmount).toBe(8);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

test("send reports ring overflow through the callback", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { server, client, socket } = await attached();
  try {
    const failures: Error[] = [];
    const sends = 9;
    await new Promise<void>((resolve) => {
      let pending = sends;
      for (let index = 0; index < sends; index += 1) {
        socket.send(new Uint8Array(MAX_MESSAGE_BYTES), (error) => {
          if (error) failures.push(error);
          pending -= 1;
          if (pending === 0) resolve();
        });
      }
    });
    expect(failures.map((error) => (error as { code?: string }).code)).toEqual([
      "ERR_BACKPRESSURE",
    ]);
  } finally {
    terminateClient(client);
    await server.dispose();
  }
});

/// The engine route cannot frame an app-initiated close yet: the first close reports the
/// missing implementation, a second is not a second event, and the socket stays OPEN.
test(
  "an unsupported engine-route close reports once and leaves the socket OPEN",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      const errors: CodedError[] = [];
      socket.on("error", (error: Error) => {
        errors.push(error as CodedError);
      });
      socket.close(1000, "done");
      socket.close(1000, "done");
      expect(errors.map((error) => error.code)).toEqual(["ERR_POLICY_VIOLATION"]);
      expect(socket.readyState).toBe(socket.OPEN);
      expect(closeFrameWritten(socket)).toBe(false);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

test("pause and resume mirror the native dispatch flag", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { server, client, socket } = await attached();
  try {
    expect(socket.isPaused).toBe(false);
    socket.pause();
    expect(socket.isPaused).toBe(true);
    socket.pause();
    expect(socket.isPaused).toBe(true);
    socket.resume();
    expect(socket.isPaused).toBe(false);
  } finally {
    terminateClient(client);
    await server.dispose();
  }
});

test("ready-state statics are non-writable like ws", () => {
  expect(() => {
    (WebSocket as unknown as { CONNECTING: number }).CONNECTING = 5;
  }).toThrow(TypeError);
  expect(WebSocket.CONNECTING).toBe(0);
});

test("binaryType accepts blob at runtime like ws", () => {
  const socket = new WebSocket(null);
  socket.binaryType = "blob" as never;
  expect(socket.binaryType).toBe("blob");
});
