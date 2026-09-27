//! `maxPayload` as the client and as a validated option.
//!
//! The server-side boundaries are in `max-payload.test.ts`. What is here is the other
//! end of the same contract: a local send over the limit is refused without closing
//! the socket, and an option out of range is refused by name before a connection is
//! ever made.

import { expect, test } from "vitest";
import { codecCeilings, codecLimits, destroyCodec } from "../../../src/binding/codec";
import { serverCodec } from "../../binding/codec-support";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

const SMALL = 1024;

test(
  "a send over the client's maxPayload reports ERR_MAX_PAYLOAD and leaves the socket open",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A local send over the limit is `ws`'s `ERR_MAX_PAYLOAD`, and `ws` does not close
    // for it: the socket is still usable, which is the difference between a send that
    // was refused and a connection that failed.
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address() as { port: number };
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/`, { maxPayload: SMALL });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      // The facade attaches a stable `code` to every error it throws, which is the
      // additive divergence from `ws` recorded in COMPATIBILITY.md, and it is the
      // `code` that says which refusal this was.
      const failures: (Error & { code?: string })[] = [];
      client.on("error", (error) => failures.push(error));
      client.send(Buffer.alloc(SMALL + 1), (error) => {
        if (error) failures.push(error);
      });
      await new Promise<void>((resolve, reject) => {
        const poll = (): void => {
          if (failures.length > 0) return resolve();
          setTimeout(poll, 5);
        };
        setTimeout(() => reject(new Error("the send was never refused")), TEST_TIMEOUT_MS).unref();
        poll();
      });
      expect(failures[0]?.code).toBe("ERR_MAX_PAYLOAD");
      expect(client.readyState).toBe(WebSocket.OPEN);
    } finally {
      client.close();
      server.close();
    }
  },
);

test("a maxPayload of 0 means no limit, as it does in ws", () => {
  // `ws` guards its length check with `_maxPayload > 0`, so zero disables it rather
  // than refusing everything. The public record therefore keeps the caller's zero,
  // which is what `ws` reports, and the normalized record carries the ceiling, which
  // is what the codec enforces.
  const server = new WebSocketServer({ noServer: true, maxPayload: 0 });
  try {
    expect(server.options.maxPayload).toBe(0);
  } finally {
    server.close();
  }
});

test("maxPayload above the compiled ceiling is refused by name", () => {
  const limits = codecLimits();
  // The compiled ceiling is now the boundary's own 32-bit width, so the only way to
  // reach it is a number past 2^32. A caller asking for that is told which option was
  // wrong rather than handed a native enum ordinal at the first connection.
  expect(limits.maxPayloadBytes).toBe(2 ** 32 - 1);
  expect(
    () => new WebSocketServer({ noServer: true, maxPayload: limits.maxPayloadBytes + 1 }),
  ).toThrow(/maxPayload/);
  expect(() => new WebSocket("ws://127.0.0.1:1/", { maxPayload: 0.5 })).toThrow(/maxPayload/);
});

test("the reported ceilings are the ones a codec enforces", () => {
  const limits = codecLimits();
  expect(limits.maxPayloadBytes).toBeGreaterThan(0);
  expect(limits.maxFragments).toBeGreaterThan(0);
  // The compiled engine cap is a separate number now, and reporting it under
  // `messageBytes` is what stops it being read as the codec's limit.
  expect(limits.messageBytes).toBeLessThan(limits.maxPayloadBytes);
});

test("a codec reports the ceilings it was created with", () => {
  // Read back rather than echoed: the point of the reader is that the number the
  // option named and the number the codec enforces are the same thing, and the only
  // way to know that is to ask the codec.
  const handle = serverCodec({ maxPayload: 4096, maxFragments: 32 });
  try {
    expect(codecCeilings(handle)).toEqual({ maxPayload: 4096, maxFragments: 32 });
  } finally {
    destroyCodec(handle);
  }
  expect(codecCeilings(handle)).toBeNull();
});

test("a maxPayload of 0 reaches the codec as the ceiling, not as zero", () => {
  // `ws` reads a zero as "no limit", so the codec is built with the largest value it
  // can enforce. Reading it back is how a caller confirms that translation happened
  // rather than assuming it.
  const handle = serverCodec({ maxPayload: 0, maxFragments: 0 });
  try {
    const limits = codecLimits();
    expect(codecCeilings(handle)).toEqual({
      maxPayload: limits.maxPayloadBytes,
      maxFragments: limits.maxFragments,
    });
  } finally {
    destroyCodec(handle);
  }
});
