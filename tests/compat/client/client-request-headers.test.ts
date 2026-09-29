//! The header precedence `ws` settles on the opening handshake, read off a hand-answering
//! raw peer. Each case here is an order rather than a value, and the order is `ws`'s:
//! the library's upgrade headers go over the caller's, URL credentials fill `Authorization`
//! only when the caller set none, and an empty `origin` is no header rather than an empty
//! one. The other order lets a caller who merges headers from a config object produce a
//! request that is not an upgrade, and the failure surfaces as a server-side 400 that names
//! nothing about the cause.

import { expect, test } from "vitest";
import { createServer } from "node:net";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { undeclared } from "./undeclared";

/// The request head, as a lower-cased record. The casing is left out because `ws` preserves
/// whatever Node derived and these assertions are about which value won.
async function requestHead(
  options: Record<string, unknown>,
  host = "127.0.0.1",
): Promise<Record<string, string>> {
  const head = await new Promise<string>((resolve) => {
    const listener = createServer((socket) => {
      socket.once("data", (data) => {
        socket.destroy();
        listener.close();
        resolve(data.toString("latin1"));
      });
    });
    listener.listen(0, "127.0.0.1", () => {
      const port = (listener.address() as { port: number }).port;
      // A raw peer never answers the upgrade, so the client is torn down once its head has
      // been read. The refusal it then reports is the expected end of this exchange.
      const socket = new WebSocket(`ws://${host}:${port}/`, undeclared(options));
      socket.once("error", () => {
        socket.terminate();
        listener.close();
      });
    });
  });
  return toRecord(head);
}

function toRecord(head: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const at = line.indexOf(":");
    if (at > 0) record[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return record;
}

test(
  "the library's upgrade headers win over a caller's",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const head = await requestHead({
      headers: { connection: "keep-alive", upgrade: "h2c" },
    });
    expect(head.connection).toBe("Upgrade");
    expect(head.upgrade).toBe("websocket");
  },
);

test("a caller's own header still reaches the request", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The complement of the case above: precedence is not the same as discarding. A caller
  // adding a tracing header is the common case and has to keep working.
  const head = await requestHead({ headers: { "X-Trace": "abc" } });
  expect(head["x-trace"]).toBe("abc");
});

test(
  "a caller's Authorization beats credentials in the URL",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // `ws` fills `Authorization` from the URL only when the caller set none
    // (`websocket.js:865`), so a bearer token is not silently downgraded to basic auth.
    const head = await requestHead(
      { headers: { Authorization: "Bearer tok" } },
      "user:pass@127.0.0.1",
    );
    expect(head.authorization).toBe("Bearer tok");
  },
);

test(
  "URL credentials fill Authorization when the caller set none",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const head = await requestHead({}, "user:pass@127.0.0.1");
    expect(head.authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  },
);

test("an empty origin sends no Origin header", { timeout: TEST_TIMEOUT_MS }, async () => {
  // `ws` gates on `if (opts.origin)`, so an empty string is a caller's "no origin"
  // rather than a header with an empty value, which some origins reject outright.
  const head = await requestHead({ origin: "" });
  expect(head.origin).toBeUndefined();
});

test(
  "origin is Origin at version 13 and Sec-WebSocket-Origin below it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const thirteen = await requestHead({ origin: "https://example.test" });
    expect(thirteen.origin).toBe("https://example.test");
    expect(thirteen["sec-websocket-origin"]).toBeUndefined();
    const eight = await requestHead({ origin: "https://example.test", protocolVersion: 8 });
    expect(eight["sec-websocket-origin"]).toBe("https://example.test");
    expect(eight.origin).toBeUndefined();
  },
);
