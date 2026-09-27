import { expect, test } from "vitest";
import { sendData } from "../../../src/compat/socket/send";
import { CLOSED, OPEN } from "../../../src/compat/ready-state";
import { createSocketState } from "../../../src/compat/socket/state";
import type { CodedError } from "../../../src/types/errors";
import { attached, terminateClient } from "./socket-support";
import { TEST_TIMEOUT_MS } from "../../binding/support";

/// A socket record with no native transport, which is what every `send` on a
/// `WebSocketServer`-produced socket looks like today, plus an `error` collector
/// wired through the real registry so the dispatch path is the one under test.
function detached(): {
  readonly errors: CodedError[];
  readonly send: (data: unknown, options?: unknown, callback?: unknown) => void;
} {
  const state = createSocketState();
  state.readyState = OPEN;
  const errors: CodedError[] = [];
  state.listeners.error = [
    (error: Error): void => {
      errors.push(error as CodedError);
    },
  ];
  return {
    errors,
    send: (data, options, callback) => sendData(state, data, options, callback),
  };
}

/// A `send` with no callback still has to report the failure. `ws` emits `error`
/// on the socket when the callback slot is empty; discarding the error instead
/// left the caller with no signal at all, because the callback is optional in
/// the published signature and `error` is the only always-available channel.
test("a failed send with no callback emits one coded error", () => {
  const socket = detached();
  socket.send("hello");
  expect(socket.errors).toHaveLength(1);
  expect(socket.errors[0].code).toBe("ERR_INVALID_STATE");
  expect(socket.errors[0].message).toMatch(/no native transport attached/);
});

test("a failed send with a callback reports through it, not the socket", async () => {
  const socket = detached();
  await new Promise<void>((resolve) => {
    socket.send("hello", undefined, (failure?: CodedError) => {
      expect(failure?.code).toBe("ERR_INVALID_STATE");
      setImmediate(resolve);
    });
  });
  expect(socket.errors).toHaveLength(0);
});

/// The report is latched once. A send that failed against a dead transport will
/// fail again, so a listener that re-sends would otherwise turn one fault into an
/// unbounded stream of identical events.
test("a repeated failure is reported once", () => {
  const socket = detached();
  socket.send("first");
  socket.send("second");
  socket.send("third");
  expect(socket.errors).toHaveLength(1);
  expect(socket.errors[0].message).toMatch(/no native transport attached/);
});

/// The failure still closes the connection, and it does so whether the report was
/// delivered or swallowed by an unhandled `error` with no listener.
test("a failed send closes the socket", () => {
  const state = createSocketState();
  state.readyState = OPEN;
  // No error listener, so the unhandled `error` throws out of `send`. The close
  // still has to have happened, which is what the `finally` in `failConnection`
  // is for.
  expect(() => sendData(state, "hello", undefined, undefined)).toThrow();
  expect(state.readyState).toBe(CLOSED);
});

/// The native route still stages, so a send that reaches the engine has nothing
/// to report and must not be turned into an error.
test("a staged send reports no error", { timeout: TEST_TIMEOUT_MS }, async () => {
  const ours = await attached();
  try {
    const seen: CodedError[] = [];
    ours.socket.on("error", (error: CodedError) => seen.push(error));
    ours.socket.send("hello");
    expect(seen).toHaveLength(0);
  } finally {
    terminateClient(ours.client);
    await ours.server.dispose();
  }
});
