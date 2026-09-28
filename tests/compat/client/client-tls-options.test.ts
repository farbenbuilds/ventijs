//! The `wss:` client options that reach `http.request`. `@types/ws` types `ClientOptions`
//! as extending `SecureContextOptions` and the `http.request` options, and `ws` spreads
//! the caller's object into the request, so a private CA or a client certificate is part of
//! the contract. Seventeen keys were read and every one of the rest was dropped, so a
//! caller pinning an internal CA got a `self-signed certificate` error naming the
//! certificate they had just supplied.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { undeclared } from "./undeclared";
import { certificates, tlsServer, TEST_TIMEOUT_MS } from "./tls-support";

/// The echoed message on a connection that opened, or the first 40 characters of the error
/// on one that did not, so every case below reads the same shape.
async function echoThrough(url: string, options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, undeclared(options));
    socket.once("open", () => {
      socket.send("hi");
    });
    socket.once("message", (data) => {
      socket.close();
      resolve(data.toString());
    });
    socket.once("error", (error: Error) => resolve(`error: ${error.message.slice(0, 40)}`));
  });
}

test(
  "rejectUnauthorized: false reaches the TLS session",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = await tlsServer();
    try {
      expect(await echoThrough(server.url, { rejectUnauthorized: false })).toBe("hi");
    } finally {
      await server.close();
    }
  },
);

test("a ca the caller supplied is trusted", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = await tlsServer();
  try {
    expect(await echoThrough(server.url, { ca: certificates().ca })).toBe("hi");
  } finally {
    await server.close();
  }
});

test(
  "an untrusted certificate is still refused by default",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The negative case matters as much as the two above: forwarding these options must
    // not have turned verification off for everyone.
    const server = await tlsServer();
    try {
      expect(await echoThrough(server.url, {})).toMatch(/^error: self-signed certificate/);
    } finally {
      await server.close();
    }
  },
);
