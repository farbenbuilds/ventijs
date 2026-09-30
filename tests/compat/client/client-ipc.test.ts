// IPC connections: the `ws+unix:` form, which is a UNIX domain socket or a Windows
// named pipe rather than a host and a port.
//
// It was recorded as `deferred` on the grounds that "`fd` transport is part of the
// client constructor", and then the error message for an unsupported scheme listed
// `ws+unix:` among the accepted ones. So the address was both rejected and advertised:
// a caller who read the error message could not tell whether the form was supported.
// It is a socket path and one line in `net.connect`, so it is supported now.

import { expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

/// A `WebSocketServer` behind a real HTTP server over one UNIX domain socket.
async function ipcServer(): Promise<{
  readonly socketPath: string;
  readonly server: WebSocketServer;
  close(): Promise<void>;
}> {
  const socketPath = `/tmp/ventiws-ipc-${process.pid}-${Date.now()}.sock`;
  const http: Server = createServer();
  const server = new WebSocketServer({ server: http });
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      socket.send(`echo:${data.toString()}`);
    });
  });
  await new Promise<void>((resolve) => {
    http.listen(socketPath, resolve);
  });
  return {
    socketPath,
    server,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    },
  };
}

test("a ws+unix address dials the socket and echoes", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await ipcServer();
  const socket = new WebSocket(`ws+unix:${harness.socketPath}:/chat`);
  socket.on("error", () => undefined);
  try {
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });
    // The request target after the separator is what the peer routes on, so a
    // mismatch here shows up as a server that never sees the connection.
    const echoed = new Promise<string>((resolve) => {
      socket.once("message", (data) => resolve(data.toString()));
    });
    socket.send("hello");
    expect(await echoed).toBe("echo:hello");
  } finally {
    socket.terminate();
    await harness.close();
  }
});

test("a ws+unix address with no path requests the root", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await ipcServer();
  const socket = new WebSocket(`ws+unix:${harness.socketPath}`);
  socket.on("error", () => undefined);
  try {
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });
    // `url` is reported as the caller wrote it, scheme and all, because an IPC
    // address has no host for a scheme rewrite to make sense of.
    expect(socket.url).toBe(`ws+unix:${harness.socketPath}`);
  } finally {
    socket.terminate();
    await harness.close();
  }
});

test("an empty ws+unix pathname is refused", () => {
  // `ws` refuses it, and the message names the specific problem rather than the
  // general one: the scheme is fine, the path is not.
  expect(() => new WebSocket("ws+unix:")).toThrowError(/pathname is empty/);
});

test("an unknown scheme is still refused", () => {
  expect(() => new WebSocket("wss+unix:/tmp/nope.sock")).toThrowError(/protocol must be one of/);
});

test("a TCP address is unaffected", async () => {
  const server = new WebSocketServer({ port: 0 });
  const accepted = new Promise<void>((resolve) => {
    server.once("connection", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/chat`);
  socket.on("error", () => undefined);
  try {
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });
    await accepted;
    expect(socket.url).toBe(`ws://127.0.0.1:${port}/chat`);
  } finally {
    socket.terminate();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
