import { expect, test } from "vitest";
import { PassThrough } from "node:stream";
import { WebSocket } from "../../../src/index";
import { attachSocket } from "../../../src/compat/socket/attach";
import { CLOSED, CLOSING, OPEN } from "../../../src/compat/ready-state";

/// A socket from the Node upgrade path, open, with a live transport and no native
/// attachment. This is the shape `WebSocketServer` produces, and the one every
/// regression below is about: the facade reaches it, the engine does not.
function upgradedSocket(): { socket: WebSocket; transport: PassThrough } {
  const socket = new WebSocket(null);
  const transport = new PassThrough();
  attachSocket(socket, transport);
  return { socket, transport };
}

test("an upgraded socket reports OPEN", () => {
  const { socket } = upgradedSocket();
  expect(socket.readyState).toBe(OPEN);
});

/// The defect this pins: `close()` latched `CLOSING` and then returned, because
/// the native close path is unreachable from the upgrade route. Nothing wrote a
/// close frame, nothing ended the transport, and the transport's own `close`
/// event is the only other way to reach `CLOSED`. A caller that called `close()`
/// and read `readyState` afterwards saw a socket that would never close again,
/// with no error and no event to explain it, for the life of the process.
test("close on an upgraded socket reaches CLOSED instead of stranding at CLOSING", () => {
  const { socket, transport } = upgradedSocket();
  const closes: Array<[number, Buffer]> = [];
  socket.on("close", (code, reason) => closes.push([code, reason]));

  socket.close(1000, "bye");

  // Observable as CLOSING until the transport's close event finishes it, which
  // is `ws`'s own ordering for `terminate()`.
  expect(socket.readyState).toBe(CLOSING);
  transport.emit("close");

  expect(socket.readyState).toBe(CLOSED);
  expect(closes).toHaveLength(1);
  expect(closes[0]?.[0]).toBe(1006);
});

test("close on an upgraded socket fires close exactly once", () => {
  const { socket, transport } = upgradedSocket();
  let count = 0;
  socket.on("close", () => {
    count += 1;
  });

  socket.close();
  transport.emit("close");
  socket.close();
  socket.terminate();
  transport.emit("close");

  expect(count).toBe(1);
});

/// A transport failure is terminal, so it is the one event a caller with no
/// callback has to observe. The defect this pins: the handler received the error
/// and discarded it, and it could not emit one either, because an earlier
/// callback-less `send` had already burned the one-way `errorEmitted` latch. A
/// peer TCP reset therefore arrived as a silent `close(1006)`.
test("a transport failure reaches the socket as an error event", () => {
  const { socket, transport } = upgradedSocket();
  const errors: Error[] = [];
  socket.on("error", (error) => errors.push(error));

  // Burn the recoverable-report latch the way a callback-less send does.
  socket.send("no callback");
  expect(socket.readyState).toBe(OPEN);

  const failure = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  transport.emit("error", failure);

  // The send's own report came first and burned the one-way latch. The transport
  // failure still arrives, which is the whole point: it is terminal, so
  // suppressing it behind an unrelated recoverable report is how a peer reset
  // used to arrive as a silent close(1006).
  expect(errors.at(-1)?.message).toBe("read ECONNRESET");
  expect(socket.readyState).toBe(CLOSING);
});

test("a transport failure still destroys the transport when error is unhandled", () => {
  const { socket, transport } = upgradedSocket();
  // No `error` listener, so `emitEvent` throws the way Node's EventEmitter does.
  expect(() => transport.emit("error", new Error("boom"))).toThrow(/boom/);
  expect(transport.destroyed).toBe(true);
  expect(socket.readyState).toBe(CLOSING);
});

/// `bufferedAmount` used to rise by the payload size on every send to a socket
/// that was not `OPEN`, and nothing ever decremented it on the upgrade route,
/// where there is no staging ring to drain. A caller polling it in a close
/// handler watched a number climb without limit.
test("bufferedAmount does not grow without bound on the upgrade route", () => {
  const { socket } = upgradedSocket();
  socket.close(1000);

  for (let index = 0; index < 50; index += 1) socket.send("x".repeat(1024));

  expect(socket.bufferedAmount).toBe(0);
});
