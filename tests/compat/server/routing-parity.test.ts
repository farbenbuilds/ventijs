import { WebSocketServer as WsServer } from "ws";
import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { rawUpgrade, request, serve, UPGRADE_HEADERS } from "./upgrade-support";

/// `ws` calls `this.shouldHandle(request)`, so reassigning the method on the
/// server record changes the routing decision. ventijs consulted a predicate it
/// held instead, which made the documented override a no-op that still looked
/// correct when invoked directly.
test("shouldHandle can be replaced on the server record", () => {
  const reference = new WsServer({ noServer: true, path: "/right" });
  const ours = new WebSocketServer({ noServer: true, path: "/right" });
  const wrong = { url: "/wrong" } as never;

  expect(reference.shouldHandle(wrong)).toBe(false);
  expect(ours.shouldHandle(wrong)).toBe(false);

  reference.shouldHandle = () => true;
  ours.shouldHandle = () => true;
  expect(reference.shouldHandle(wrong)).toBe(true);
  expect(ours.shouldHandle(wrong)).toBe(true);
});

/// The override has to reach the routing decision itself, not just the method a
/// caller can invoke. This is the observable half: a request on the wrong path
/// is accepted once the method is replaced.
test("a replaced shouldHandle changes the routing decision", async () => {
  const harness = await serve(new WebSocketServer({ noServer: true, path: "/right" }));
  try {
    const refused = await rawUpgrade(harness.port, request("/wrong", UPGRADE_HEADERS));
    expect(refused.status).toBe(400);

    harness.server.shouldHandle = () => true;
    const accepted = await rawUpgrade(harness.port, request("/wrong", UPGRADE_HEADERS));
    expect(accepted.status).toBe(101);
  } finally {
    await harness.close();
  }
});

/// `ws` assigns the negotiated subprotocol before it emits `open`, so anything
/// already observing the socket at that point sees the selection. ventijs adopted
/// the stream first, which is what sets `OPEN` and emits `open`, and published the
/// protocol afterwards.
///
/// The only observer that can see `open` before the `connection` handler runs is
/// one installed in the socket's own constructor, because `ws` emits `open`
/// before it emits `connection` too. That is the real path, through a custom
/// `WebSocket` class or an `onopen` attribute set there.
test("the negotiated protocol is set before the open event fires", async () => {
  const observed: string[] = [];
  // `Reflect.construct` honours a returned object, so this constructor-shaped
  // function installs its observer on the very socket the upgrade path adopts.
  // A class would be the obvious spelling and is banned repo-wide.
  const Observing = function (): WebSocket {
    const socket = new WebSocket(null);
    socket.addEventListener("open", () => {
      observed.push(socket.protocol);
    });
    return socket;
  } as unknown as NonNullable<WebSocketServer["options"]>["WebSocket"];

  const server = new WebSocketServer({
    noServer: true,
    handleProtocols: () => "chat",
    WebSocket: Observing,
  });
  const harness = await serve(server);
  try {
    const headers = { ...UPGRADE_HEADERS, "Sec-WebSocket-Protocol": "chat" };
    const result = await rawUpgrade(harness.port, request("/", headers));
    expect(result.status).toBe(101);
    await new Promise((resolve) => setImmediate(resolve));
    expect(observed).toEqual(["chat"]);
  } finally {
    await harness.close();
  }
});
