import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";
import { closeServer } from "../../src/binding/server";
import { fixture, TEST_TIMEOUT_MS } from "./support";

/// Runs the raw addon in a worker: create and listen a server, report its
/// handle, and wait for the exit signal. `process.exit` runs the environment
/// cleanup hook, which must stop the engine thread and free the instance.
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const path = require("node:path");
const addon = require(path.join(process.cwd(), "zig-out/lib/ventiws.node"));
const handle = addon.createServer({ host: "127.0.0.1", port: 0 }, () => {});
addon.listenServer(handle);
parentPort.postMessage(handle);
parentPort.once("message", (message) => {
  if (message === "exit") process.exit(0);
});
`;

async function startWorker(): Promise<{ readonly worker: Worker; readonly handle: number }> {
  const worker = new Worker(WORKER_SOURCE, { eval: true });
  const [handle] = (await once(worker, "message")) as [number];
  return { worker, handle };
}

test("a handle from another worker is rejected", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { worker, handle } = await startWorker();
  try {
    expect(() => closeServer(handle)).toThrow(/UnknownServer/);
  } finally {
    worker.postMessage("exit");
    await once(worker, "exit");
  }
});

test("environment teardown retires the worker's server", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { worker } = await startWorker();
  worker.postMessage("exit");
  await once(worker, "exit");

  // Slot 0 is only free if the cleanup hook retired the worker's server; a
  // leaked instance would hand this one slot 1.
  const fresh = fixture({ host: "127.0.0.1", port: 0 });
  try {
    expect(fresh.handle & 0xff).toBe(0);
  } finally {
    await fresh.dispose();
  }
});
