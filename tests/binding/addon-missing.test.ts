//! What a caller reads when the native addon is not there. The load is lazy so importing
//! ventiws works without the artifact, which left the first load inside an `upgrade` listener
//! where a missing artifact was an uncaught exception: hence a pure message function.

import { expect, test } from "vitest";
import { missingAddonMessage } from "../../src/binding/addon-error";
import { PUBLISHED_TARGETS } from "../../src/binding/target";
import { WebSocketServer } from "../../src/index";

test("the message names the platform", () => {
  const message = missingAddonMessage(
    "/opt/app/node_modules/ventiws",
    "linux",
    "x64",
    "linux-x64-gnu",
    PUBLISHED_TARGETS,
  );
  // The platform is the overwhelmingly common cause, and a message that omits it sends the reader to rebuild for the wrong machine.
  expect(message).toContain("linux-x64-gnu");
  expect(message).toContain("/opt/app/node_modules/ventiws");
  expect(message.startsWith("ventiws:")).toBe(true);
});

test("the advice is reachable by whoever hits it", () => {
  const message = missingAddonMessage(
    "/opt/app/node_modules/ventiws",
    "linux",
    "x64",
    "linux-x64-gnu",
    PUBLISHED_TARGETS,
  );
  // It says what has to be true, not only what a maintainer would do.
  expect(message).toContain("optional dependency");
  expect(message).toContain("pnpm build:binding");
});

test("a broken layout is described differently from a platform mismatch", () => {
  // No `package.json` above the addon is a corrupted install, not a wrong-platform one, so "rebuild for linux-x64" is the wrong advice.
  const message = missingAddonMessage(
    undefined,
    "linux",
    "x64",
    "linux-x64-gnu",
    PUBLISHED_TARGETS,
  );
  expect(message).toContain("Reinstalling");
  expect(message).not.toContain("pnpm build:binding");
});

test("an unpublished platform lists what a published ventiws does ship", () => {
  // npm installs an optional dependency only when the host matches it, so on freebsd the
  // install is clean and there is no binary: the published list is the whole remedy.
  // Windows is the same case today, which is why it is asserted here too.
  const message = missingAddonMessage(
    "/opt/app/node_modules/ventiws",
    "freebsd",
    "x64",
    undefined,
    PUBLISHED_TARGETS,
  );
  expect(message).toContain("freebsd-x64");
  expect(message).toContain("linux-x64-gnu");
  expect(message).toContain("pnpm build:binding");

  const onWindows = missingAddonMessage(
    "C:\\app\\node_modules\\ventiws",
    "win32",
    "x64",
    undefined,
    PUBLISHED_TARGETS,
  );
  expect(onWindows).toContain("win32-x64");
  expect(onWindows).toContain("darwin-arm64");
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
