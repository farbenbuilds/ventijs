import { expect, test } from "vitest";
import { sendData } from "../../../src/compat/socket/send";
import { CLOSED, CLOSING, OPEN } from "../../../src/compat/ready-state";
import type { ReadyState } from "../../../src/types/close";
import { createSocketState } from "../../../src/compat/socket/state";
import type { CodedError } from "../../../src/types/errors";
import { attached, terminateClient } from "./socket-support";
import { TEST_TIMEOUT_MS } from "../../binding/support";

/// A socket record with no native transport, which is what every `send` on a
/// `WebSocketServer`-produced socket looks like today, plus an `error` collector
/// wired through the real registry so the dispatch path is the one under test.
function detached(readyState: ReadyState): {
  readonly errors: CodedError[];
  readonly send: (data: unknown, options?: unknown, callback?: unknown) => void;
} {
  const state = createSocketState();
  state.readyState = readyState;
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

/// A send that fails on an *open* socket is the only place `ws` emits `error`,
/// through `emitErrorAndClose`. Discarding it instead left a caller with no
/// signal at all, because the callback is optional in the published signature and
/// `error` is the only always-available channel.
test("a failed send on an open socket emits one coded error", () => {
  const socket = detached(OPEN);
  socket.send("hello");
  expect(socket.errors).toHaveLength(1);
  expect(socket.errors[0].code).toBe("ERR_INVALID_STATE");
  expect(socket.errors[0].message).toMatch(/no native transport attached/);
});

/// A send that fails on an open socket with a callback reports through it and does
/// not also emit, matching `ws`.
test("a failed send with a callback reports through it, not the socket", async () => {
  const socket = detached(OPEN);
  await new Promise<void>((resolve) => {
    socket.send("hello", undefined, (failure?: CodedError) => {
      expect(failure?.code).toBe("ERR_INVALID_STATE");
      setImmediate(resolve);
    });
  });
  expect(socket.errors).toHaveLength(0);
});

/// The report is latched once, as `ws` latches `_errorEmitted`. A send that failed
/// against a dead transport will fail again, so a listener that re-sends would
/// otherwise turn one fault into an unbounded stream of identical events.
test("a repeated failure is reported once", () => {
  const socket = detached(OPEN);
  socket.send("first");
  socket.send("second");
  socket.send("third");
  expect(socket.errors).toHaveLength(1);
});

/// A send on a socket that is not open goes to `sendAfterClose`, which accounts
/// the bytes, tells the callback, and does nothing else. Routing it through the
/// error path would close a socket that was merely mid-close, which is a
/// divergence `ws` does not have: a caller that sends while a close is in
/// progress keeps its socket and its close.
test.each([
  ["closing", CLOSING],
  ["closed", CLOSED],
])("a send while %s reports through the callback and changes nothing", async (name, state) => {
  const socket = detached(state);
  let reported: CodedError | undefined;
  socket.send("hello", undefined, (failure?: CodedError) => {
    reported = failure;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(reported?.message).toMatch(new RegExp(`readyState ${String(state)}`));
  expect(socket.errors).toHaveLength(0);
});

/// A failed send reports and leaves the socket alone.
///
/// This is the sharpest divergence from `ws` in the send path, and the reason is
/// what is being reported. `ws` is silent, because a write error reaches the
/// caller's callback and its socket listener destroys the transport. ventiws has
/// to emit, because a caller that passed no callback has nothing else, and it must
/// not close, because the condition is a missing transport rather than a fault of
/// the connection. Closing here would turn "this build cannot send yet" into "your
/// connection died" for every caller that writes before the native attachment
/// exists, which is every caller of a `WebSocketServer`.
test("a failed send reports and leaves the socket usable", () => {
  const state = createSocketState();
  state.readyState = OPEN;
  expect(() => sendData(state, "hello", undefined, undefined)).toThrow();
  expect(state.readyState).toBe(OPEN);
  expect(state.errorEmitted).toBe(true);
});

/// The latch holds, so a second failure is not a second event. A caller that
/// re-sends after the first report would otherwise get an unbounded stream of
/// identical events for one condition.
test("a second failure after the first is not reported again", () => {
  const socket = detached(OPEN);
  socket.send("first");
  expect(socket.errors).toHaveLength(1);
  socket.send("second");
  expect(socket.errors).toHaveLength(1);
  expect(socket.errors[0].message).toMatch(/no native transport attached/);
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
