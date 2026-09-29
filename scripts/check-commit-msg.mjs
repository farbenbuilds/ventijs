#!/usr/bin/env node
// Refuses a commit message that carries a CI skip marker.
//
// A squash merge concatenates every commit body into the one message it puts on `main`,
// and GitHub matches a skip marker *anywhere* in a message rather than in the subject
// alone. So a branch whose commits merely describe the marker produce a merge that skips
// every workflow on the repository -- and a skipped push starts no workflow at all, so
// nothing in CI can report it. This is the only place the mistake can still be caught.
//
// It runs from a `commit-msg` hook, so it covers a human commit and not the one
// `bump.yml` writes: CI does not install the hooks, and that commit deliberately carries
// no marker, because a release tag can point at it.

import { readFileSync } from "node:fs";
import { argv } from "node:process";

/// The five forms GitHub recognises, plus the reason each is refused: the failure is
/// invisible from CI, so the message has to say what to do instead.
const MARKERS = ["skip ci", "ci skip", "no ci", "skip actions", "actions skip"];

function violations(message) {
  return MARKERS.filter((marker) => message.includes(`[${marker}]`));
}

function main() {
  const file = argv[2];
  if (file === undefined) throw new Error("check-commit-msg: no message file given");
  const message = readFileSync(file, "utf8").replace(/^#.*$/gm, "");

  const found = violations(message);
  if (found.length === 0) return;

  process.stderr.write("check-commit-msg: this marker would silence CI for the merge\n");
  for (const marker of found) process.stderr.write(`  [${marker}]\n`);
  process.stderr.write(
    "\nA squash merge puts every commit body into the message on main, and GitHub\n" +
      "reads the marker anywhere in it. Nothing then runs, including the bump, and\n" +
      "a skipped push starts no workflow that could report it.\n\n" +
      "If the merge is quiet, run it by hand:\n" +
      "  gh workflow run bump.yml --ref main\n",
  );
  process.exit(1);
}

main();
