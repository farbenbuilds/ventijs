import { expect, test } from "vitest";
import {
  closeSocket,
  pauseSocket,
  resumeSocket,
  sendSocket,
  socketBufferedAmount,
} from "../../src/binding/socket";
import { engineLimits } from "../../src/binding/server";
import { connectedSocket } from "./socket-support";
import { TEST_TIMEOUT_MS } from "./support";

/// Read from the addon rather than restated. The cap is a Zig comptime constant
/// and a TypeScript copy of it is a second source of truth: the cap was raised
/// from 32 KiB to 64 KiB while this file still asserted 32 KiB, so the boundary
/// test passed by asserting a limit the engine no longer enforced.
const MESSAGE_BYTES = engineLimits().messageBytes;

test(
  "stages outbound payloads and reports the buffered amount",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, connection, socket } = await connectedSocket();
    try {
      expect(sendSocket(server.handle, connection, new Uint8Array([1, 2, 3]), true)).toBe("ok");
      expect(socketBufferedAmount(server.handle, connection)).toBe(3);
      expect(sendSocket(server.handle, connection, new TextEncoder().encode("hi"))).toBe("ok");
      expect(socketBufferedAmount(server.handle, connection)).toBe(5);
    } finally {
      socket.close();
      await server.dispose();
    }
  },
);

test(
  "send is bounded by the payload cap and the staging ring",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, connection, socket } = await connectedSocket();
    try {
      const exact = new Uint8Array(MESSAGE_BYTES);
      expect(sendSocket(server.handle, connection, exact, true)).toBe("ok");
      expect(sendSocket(server.handle, connection, new Uint8Array(MESSAGE_BYTES + 1))).toBe(
        "payload-too-large",
      );

      for (let staged = 0; staged < 7; staged += 1) {
        expect(sendSocket(server.handle, connection, new Uint8Array([staged]))).toBe("ok");
      }
      expect(sendSocket(server.handle, connection, new Uint8Array([0xff]))).toBe("backpressure");
      expect(socketBufferedAmount(server.handle, connection)).toBe(MESSAGE_BYTES + 7);
    } finally {
      socket.close();
      await server.dispose();
    }
  },
);

test(
  "close transitions exactly once and rejects later sends",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, connection, socket } = await connectedSocket();
    try {
      expect(closeSocket(server.handle, connection, 1000, new Uint8Array())).toBe("ok");
      expect(closeSocket(server.handle, connection, 1000, new Uint8Array())).toBe("closing");
      expect(sendSocket(server.handle, connection, new Uint8Array([1]))).toBe("closing");
      expect(closeSocket(server.handle, connection, 1005, new Uint8Array())).toBe("closing");
    } finally {
      socket.close();
      await server.dispose();
    }
  },
);

test("pause and resume are idempotent", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { server, connection, socket } = await connectedSocket();
  try {
    expect(pauseSocket(server.handle, connection)).toBe("ok");
    expect(pauseSocket(server.handle, connection)).toBe("ok");
    expect(resumeSocket(server.handle, connection)).toBe("ok");
    expect(resumeSocket(server.handle, connection)).toBe("ok");
  } finally {
    socket.close();
    await server.dispose();
  }
});
