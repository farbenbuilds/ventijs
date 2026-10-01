// The auto-wired records are the feature, so these enable the logger, run a real server
// and client, and read the lifecycle off stdout: the splash, both opens, both closes,
// the server's own close, and the error records. The test never calls the logger.

import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { version } from "../../package.json" with { type: "json" };
import { WebSocket, WebSocketServer } from "../../src/index";
import { setLoggerEnabled } from "../../src/logging/logger";
import { TEST_TIMEOUT_MS } from "../binding/support";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const visible = (text: string): string => text.replace(ANSI, "");
const records = (text: string): string[] => text.split("\n").filter((line) => line.includes(" | "));

async function capture(run: () => Promise<void>): Promise<string> {
  const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await run();
    return spy.mock.calls.map((call) => String(call[0] ?? "")).join("");
  } finally {
    spy.mockRestore();
  }
}

function listeningPort(server: WebSocketServer): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
    server.once("error", reject);
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => socket.once("close", () => resolve()));
}

function stop(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeEach(() => setLoggerEnabled(true));
afterEach(() => setLoggerEnabled(false));

test(
  "a server and client log their lifecycle, and message traffic adds no record",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    let port = 0;
    const output = await capture(async () => {
      const server = new WebSocketServer({ port: 0 });
      port = await listeningPort(server);
      const received = new Promise<string>((resolve) => {
        server.on("connection", (socket) => {
          socket.on("message", (data) => resolve(data.toString()));
        });
      });
      const client = new WebSocket(`ws://127.0.0.1:${port}/`);
      await opened(client);
      client.send("hello");
      expect(await received).toBe("hello");
      client.close(1000, "done");
      await closed(client);
      await stop(server);
    });
    const text = visible(output);
    expect(text).toMatch(new RegExp(`ventiws ${version} ready in \\d+`));
    expect(text).toContain(`➜  Local: localhost:${port}/`);
    const lines = records(text);
    expect(lines).toHaveLength(5);
    const at = (needle: string): number => lines.findIndex((line) => line.includes(needle));
    expect(at("| connection : open")).toBeGreaterThanOrEqual(0);
    expect(at("| client : open")).toBeGreaterThanOrEqual(0);
    expect(at("| connection : closed 1000 done")).toBeGreaterThanOrEqual(0);
    expect(at("| client : closed 1000")).toBeGreaterThanOrEqual(0);
    expect(at("| server : closed")).toBe(4);
    expect(at("| connection : open")).toBeLessThan(at("| connection : closed"));
    expect(at("| client : open")).toBeLessThan(at("| client : closed"));
  },
);

test(
  "the lifecycle is silent while the logger is disabled",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    setLoggerEnabled(false);
    const output = await capture(async () => {
      const server = new WebSocketServer({ port: 0 });
      const port = await listeningPort(server);
      const client = new WebSocket(`ws://127.0.0.1:${port}/`);
      await opened(client);
      client.close(1000);
      await closed(client);
      await stop(server);
    });
    expect(output).toBe("");
  },
);

test("a refused client logs its own fatal record", { timeout: TEST_TIMEOUT_MS }, async () => {
  const output = await capture(async () => {
    const client = new WebSocket("ws://127.0.0.1:1/");
    const failed = new Promise<void>((resolve) => client.once("error", () => resolve()));
    const done = closed(client);
    await failed;
    await done;
  });
  expect(records(visible(output))[0]).toMatch(/^\d{2}:\d{2}:\d{2} \| client : .+$/);
});

test("a refused bind logs the server error record", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The fixture server is silenced so the capture below holds the failure alone.
  setLoggerEnabled(false);
  const first = new WebSocketServer({ port: 0 });
  const port = await listeningPort(first);
  setLoggerEnabled(true);
  const output = await capture(async () => {
    const second = new WebSocketServer({ port });
    await new Promise<void>((resolve) => second.once("error", () => resolve()));
    await stop(second);
  });
  setLoggerEnabled(false);
  await stop(first);
  expect(records(visible(output))[0]).toMatch(/^\d{2}:\d{2}:\d{2} \| server : .+$/);
});
