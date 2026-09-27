//! What a caller reads when the native addon is not there.
//!
//! The load is lazy on purpose, so importing ventijs has to work on a machine where the
//! artifact does not exist -- a program that imports the types, or one that never opens
//! a socket, has no business failing. That left the first load inside a Node `upgrade`
//! listener, where a missing artifact was an uncaught exception that took the process
//! down, with a message telling the reader to run `pnpm build:binding`: a command an
//! installed consumer does not have, in a tree they do not have.
//!
//! So the message is a pure function with a direct test, and the server constructor
//! performs the load.

import { expect, test } from "vitest";
import { missingAddonMessage } from "../../src/binding/addon-error";
import { WebSocketServer } from "../../src/index";

test("the message names the platform", () => {
  const message = missingAddonMessage("/opt/app/node_modules/ventijs", "linux", "x64");
  // The platform is the first thing worth knowing. An install ships the addon for one
  // platform, a mismatch is the overwhelmingly common cause, and a message that does
  // not name it sends the reader to rebuild for a machine they may not be on.
  expect(message).toContain("linux-x64");
  expect(message).toContain("/opt/app/node_modules/ventijs");
  expect(message.startsWith("ventijs:")).toBe(true);
});

test("the advice is reachable by whoever hits it", () => {
  const message = missingAddonMessage("/opt/app/node_modules/ventijs", "linux", "x64");
  // It says what has to be true, not only what a maintainer would do. A message that
  // only names `pnpm build:binding` reads as though a package manager is the only way
  // to fix an install.
  expect(message).toContain("zig 0.16.0");
  expect(message).toContain("pnpm build:binding");
});

test("a broken layout is described differently from a platform mismatch", () => {
  // No `package.json` above the addon is not a wrong-platform install; it is a
  // corrupted one, and reinstalling is the answer. Saying "rebuild for
  // linux-x64" there would send the reader to compile a package that is already
  // unpacked wrongly.
  const message = missingAddonMessage(undefined, "linux", "x64");
  expect(message).toContain("Reinstalling");
  expect(message).not.toContain("pnpm build:binding");
});

test("the server constructor performs the load", () => {
  // The load is unconditional, and a test that could tell the difference would have to
  // break the tree. What this pins is the other half: a present addon still loads and
  // the constructor still returns a working record, so the check is not a fast path
  // that skips the work.
  const server = new WebSocketServer({ noServer: true });
  try {
    expect("clients" in server).toBe(true);
    expect(server.options.maxPayload).toBe(104857600);
  } finally {
    server.close();
  }
});
