//! What a caller reads when the native addon is not there. The load is lazy so importing
//! ventijs works without the artifact, which left the first load inside an `upgrade` listener
//! where a missing artifact was an uncaught exception: hence a pure message function.

import { expect, test } from "vitest";
import { missingAddonMessage } from "../../src/binding/addon-error";
import { WebSocketServer } from "../../src/index";

test("the message names the platform", () => {
  const message = missingAddonMessage("/opt/app/node_modules/ventijs", "linux", "x64");
  // The platform is the overwhelmingly common cause, and a message that omits it sends the reader to rebuild for the wrong machine.
  expect(message).toContain("linux-x64");
  expect(message).toContain("/opt/app/node_modules/ventijs");
  expect(message.startsWith("ventijs:")).toBe(true);
});

test("the advice is reachable by whoever hits it", () => {
  const message = missingAddonMessage("/opt/app/node_modules/ventijs", "linux", "x64");
  // It says what has to be true, not only what a maintainer would do.
  expect(message).toContain("zig 0.16.0");
  expect(message).toContain("pnpm build:binding");
});

test("a broken layout is described differently from a platform mismatch", () => {
  // No `package.json` above the addon is a corrupted install, not a wrong-platform one, so "rebuild for linux-x64" is the wrong advice.
  const message = missingAddonMessage(undefined, "linux", "x64");
  expect(message).toContain("Reinstalling");
  expect(message).not.toContain("pnpm build:binding");
});

test("the server constructor performs the load", () => {
  // A test that could tell the difference would have to break the tree; this pins that a present addon still loads.
  const server = new WebSocketServer({ noServer: true });
  try {
    expect("clients" in server).toBe(true);
    expect(server.options.maxPayload).toBe(104857600);
  } finally {
    server.close();
  }
});
