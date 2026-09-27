import { expect, test } from "vitest";
import { PassThrough } from "node:stream";
import { finishConnection } from "../../../src/compat/socket/lifecycle";
import { OPEN } from "../../../src/compat/ready-state";
import { socketStateOf } from "../../../src/compat/socket/state";
import { WebSocket } from "../../../src/index";

/// A socket that is closed or terminated while still `CONNECTING` reports the
/// aborted handshake, matching `ws`, which routes both through `abortHandshake`:
/// an `error` naming the failure, then `close` with 1006. Finishing silently left
/// a caller with a 1006 and no indication that a handshake had been attempted.
test.each(["close", "terminate"])("%s while connecting reports the aborted handshake", (op) => {
  const socket = new WebSocket(null);
  const errors: Error[] = [];
  const closes: Array<[number, Buffer]> = [];
  socket.on("error", (error) => {
    errors.push(error);
  });
  socket.on("close", (code, reason) => {
    closes.push([code, reason]);
  });
  expect(() => socket.send("hello")).toThrow(/readyState 0 \(CONNECTING\)/);
  if (op === "close") socket.close();
  else socket.terminate();
  expect(errors.map((error) => error.message)).toEqual([
    "WebSocket was closed before the connection was established",
  ]);
  expect(socket.readyState).toBe(socket.CLOSED);
  expect(closes).toEqual([[1006, Buffer.alloc(0)]]);
  // The terminal state is latched, so a repeated call emits nothing further.
  socket.terminate();
  expect(closes).toHaveLength(1);
});

/// A socket with a transport is observably `CLOSING` from `terminate()` until the
/// transport's `close` event finishes it, because `ws` latches before it
/// destroys. Without a transport there is nothing to wait for, so the socket
/// finishes immediately rather than latching a state nothing will ever advance.
test("terminate latches CLOSING while the transport is still closing", () => {
  const socket = new WebSocket(null);
  const state = socketStateOf(socket);
  if (state === undefined) throw new Error("expected a ventijs socket record");
  const transport = new PassThrough();
  transport.on("close", () => {
    finishConnection(state, 1006, Buffer.alloc(0));
  });
  state.transport = transport;
  state.readyState = OPEN;

  socket.terminate();
  expect(socket.readyState).toBe(socket.CLOSING);
  // A second terminate must not advance a socket that is already closing.
  socket.terminate();
  expect(socket.readyState).toBe(socket.CLOSING);

  const finished = new Promise<void>((resolve) => {
    socket.on("close", () => resolve());
  });
  transport.emit("close");
  return expect(finished).resolves.toBeUndefined();
});

test("terminate on a socket with no transport finishes it immediately", () => {
  const socket = new WebSocket(null);
  const state = socketStateOf(socket);
  if (state === undefined) throw new Error("expected a ventijs socket record");
  state.readyState = OPEN;
  socket.terminate();
  expect(socket.readyState).toBe(socket.CLOSED);
});
