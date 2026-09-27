import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "./binding/support";
import { nextSocket, upgradeHarness } from "./compat/socket/codec-upgrade-support";
import { WebSocket, WebSocketServer } from "../src/index";

test("probe", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const client = new WebSocket(harness.url, undefined, { allowSynchronousEvents: false } as never);
  client.on("error", () => undefined);
  await new Promise<void>((r) => {
    client.once("open", () => r());
  });
  try {
    const socket = await accepted;
    const seen: string[] = [];
    client.on("message", (d: Buffer) => seen.push(d.toString()));
    client.on("error", (e: Error) => console.log("CLIENTERROR", e.message));
    for (const t of ["one", "two", "three"]) socket.send(t);
    await new Promise<void>((r) => setTimeout(r, 300));
    console.log("SEEN", JSON.stringify(seen), "state", client.readyState);
    expect(true).toBe(true);
  } finally {
    client.terminate();
    await harness.close();
  }
});
