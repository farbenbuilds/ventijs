import { WebSocketServer as WsServer } from "ws";
import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";

/// The `ws`-shaped server record is built from options before any connection
/// exists, so these are pure property comparisons: every one of them was
/// asserted against a running suite when it was wrong, and none of them needs a
/// socket to be observable.

type Record_ = Record<string, unknown>;

function read(server: object, key: string): unknown {
  return (server as Record_)[key];
}

function present(server: object, key: string): boolean {
  return key in server;
}

test("clientTracking false leaves clients undefined, as ws does", () => {
  // `ws` only adds the property when tracking is truthy, so an empty set is a
  // visible difference: `server.clients.size` is 0 in ws and throws here, and
  // `for (const c of server.clients)` iterates nothing in ws and throws here.
  const reference = new WsServer({ clientTracking: false, noServer: true });
  expect(read(reference, "clients")).toBeUndefined();

  const ours = new WebSocketServer({ clientTracking: false, noServer: true });
  expect(read(ours, "clients")).toBeUndefined();
  expect(present(ours, "clients")).toBe(true);
});

test("clientTracking true adds a set in both", () => {
  const reference = new WsServer({ noServer: true });
  expect((read(reference, "clients") as Set<unknown>).size).toBe(0);

  const ours = new WebSocketServer({ noServer: true });
  expect((read(ours, "clients") as Set<unknown>).size).toBe(0);
});

/// `path` is declared by `@types/ws` but `ws`'s runtime never sets it, so
/// `"path" in server` is false there. ventijs exposes it, which is a superset:
/// reading it is harmless, but the divergence is recorded so nobody writes a
/// test that assumes the two agree on its presence.
test("ws does not expose path at runtime", () => {
  const reference = new WsServer({ noServer: true, path: "/ws" });
  expect(present(reference, "path")).toBe(false);

  const ours = new WebSocketServer({ noServer: true, path: "/ws" });
  expect(read(ours, "path")).toBe("/ws");
});

/// `ws` rewrites the `perMessageDeflate: true` shorthand to an options object on
/// the public record, so a caller that inspects `server.options` sees an object
/// rather than the boolean it passed.
test("perMessageDeflate true is rewritten to an object", () => {
  const reference = new WsServer({ noServer: true, perMessageDeflate: true });
  const expected = read(reference.options, "perMessageDeflate");
  expect(typeof expected).toBe("object");

  const ours = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  expect(typeof read(ours.options, "perMessageDeflate")).toBe("object");
});

/// The three sender limits `@types/ws` declares and the reference does not list.
/// They are observable on `server.options`, so omitting them made a defaulted
/// record a strict subset of the contract.
test.each([
  ["maxBufferedChunks", 262144],
  ["maxFragments", 16384],
  ["closeTimeout", 30000],
  ["maxPayload", 100 * 1024 * 1024],
  ["allowSynchronousEvents", true],
  ["autoPong", true],
  ["skipUTF8Validation", false],
])("server.options defaults %s to the ws value", (key, expected) => {
  const reference = new WsServer({ noServer: true });
  const ours = new WebSocketServer({ noServer: true });
  expect(read(ours.options, key)).toBe(expected);
  expect(read(ours.options, key)).toBe(read(reference.options, key));
});

test("an explicit option is never overwritten by the defaults", () => {
  const ours = new WebSocketServer({ noServer: true, maxPayload: 1024, autoPong: false });
  expect(read(ours.options, "maxPayload")).toBe(1024);
  expect(read(ours.options, "autoPong")).toBe(false);
});
