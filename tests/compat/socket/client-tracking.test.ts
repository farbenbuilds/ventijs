//! `clientTracking`, which decides whether `server.clients` exists at all. Its own file because
//! it is the one option whose *absence* is the observable: `ws` leaves the key off the server
//! entirely rather than setting it to `undefined`.

import { expect, test } from "vitest";
import { WebSocketServer, type ServerOptions } from "../../../src/index";
import { normalizeServerOptions } from "../../../src/compat/options/server";

/// `@types/ws` declares this as `boolean`, so `0` and `""` need the cast a JavaScript caller makes implicitly.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

test("a falsy clientTracking leaves clients absent, as ws does", () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, clientTracking: 0 }));
  try {
    // Absent rather than present-and-undefined, so `in`, `Object.keys`, and `JSON.stringify` agree with `ws`.
    expect("clients" in server).toBe(false);
  } finally {
    server.close();
  }
});

/// `null`, `0`, and `""` were read as absent, which put a `clients` set on the server where `ws` has
/// none and made `close()` wait for connections where `ws` emits on the next tick.
test("clientTracking is a truthiness, not an identity", () => {
  for (const value of [undefined, true, 1, "yes"] as readonly unknown[]) {
    expect(
      normalizeServerOptions(atRuntime({ noServer: true, clientTracking: value })).clientTracking,
    ).toBe(true);
  }
  for (const value of [false, null, 0, ""] as readonly unknown[]) {
    expect(
      normalizeServerOptions(atRuntime({ noServer: true, clientTracking: value })).clientTracking,
    ).toBe(false);
  }
});
