import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { attachSocket } from "../../../src/compat/socket/attach";
import { PassThrough } from "node:stream";

function upgradedSocket(): WebSocket {
  const socket = new WebSocket(null);
  attachSocket(socket, new PassThrough());
  return socket;
}

/// Collects the warnings one registration burst raises, then puts the process
/// warning channel back the way it was found.
async function captureWarnings(action: () => void): Promise<string[]> {
  const seen: string[] = [];
  const listener = (warning: Error & { name?: string }): void => {
    if (warning.name === "MaxListenersExceededWarning") seen.push(warning.message);
  };
  process.on("warning", listener);
  try {
    action();
    // `process.emitWarning` defers to the next tick, so the listener needs one
    // turn to run before the channel is restored.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("warning", listener);
  }
  return seen;
}

/// The warning names the first count that passes the limit, not the count at the
/// end of the burst, which is what `EventEmitter` reports.
test("passing maxListeners raises the Node leak warning", async () => {
  const socket = upgradedSocket();
  const warnings = await captureWarnings(() => {
    for (let index = 0; index < 12; index += 1) socket.on("close", () => {});
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("11 close listeners added");
  expect(warnings[0]).toContain("MaxListeners is 10");
});

/// Node warns once per event, not once per registration. A repeated warning for
/// a single leak trains callers to ignore it.
test("the leak warning is raised once per event", async () => {
  const socket = upgradedSocket();
  const warnings = await captureWarnings(() => {
    for (let index = 0; index < 15; index += 1) socket.on("close", () => {});
    for (let index = 0; index < 15; index += 1) socket.on("error", () => {});
  });
  expect(warnings).toHaveLength(2);
});

test("a second event warns independently", async () => {
  const socket = upgradedSocket();
  const warnings = await captureWarnings(() => {
    for (let index = 0; index < 12; index += 1) socket.on("close", () => {});
  });
  const second = await captureWarnings(() => {
    for (let index = 0; index < 12; index += 1) socket.on("message", () => {});
  });
  expect(warnings[0]).toContain("close");
  expect(second[0]).toContain("message");
});

/// `setMaxListeners(0)` means unlimited in Node, because the guard is `> 0`. It
/// suppressed nothing here before, and suppressing nothing is the bug.
test("setMaxListeners(0) means unlimited", async () => {
  const socket = upgradedSocket();
  socket.setMaxListeners(0);
  const warnings = await captureWarnings(() => {
    for (let index = 0; index < 200; index += 1) socket.on("close", () => {});
  });
  expect(warnings).toHaveLength(0);
});

test("raising the limit stops the warning", async () => {
  const socket = upgradedSocket();
  socket.setMaxListeners(50);
  const warnings = await captureWarnings(() => {
    for (let index = 0; index < 20; index += 1) socket.on("close", () => {});
  });
  expect(warnings).toHaveLength(0);
});

/// Node drops the per-event flag on `removeAllListeners`, so a listener removed
/// and re-added past the limit warns again instead of staying silent for the
/// rest of the process.
test("removeAllListeners resets the leak warning", async () => {
  const socket = upgradedSocket();
  const first = await captureWarnings(() => {
    for (let index = 0; index < 12; index += 1) socket.on("close", () => {});
  });
  socket.removeAllListeners("close");
  const second = await captureWarnings(() => {
    for (let index = 0; index < 12; index += 1) socket.on("close", () => {});
  });
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
});
