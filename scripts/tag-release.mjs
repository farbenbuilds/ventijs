#!/usr/bin/env node
// Tags the version `package.json` already carries and pushes it.
//
// The version moves on merge, so this no longer decides one: it publishes the version the
// repository is already sitting on. That is what keeps the tag a release decision rather
// than a second place a version can be written, and it is why `check-release-tag.mjs`
// compares the tag against the manifest instead of against a bump it made itself.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/// git's stdout, for the two questions this asks of it. Empty on failure, which is the
/// answer for both: a detached HEAD and a missing branch are both "not a branch".
const ask = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

function push(args) {
  const run = spawnSync("git", args, { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`tag-release: git ${args.join(" ")} failed`);
}

function main() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const tag = `v${version}`;

  if (ask(["status", "--porcelain"]) !== "")
    throw new Error("tag-release: the working tree is dirty");
  const branch = ask(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "" || branch === "HEAD") throw new Error("tag-release: HEAD is not on a branch");
  if (ask(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]) !== "")
    throw new Error(`tag-release: ${tag} already exists`);

  // `bump.yml` pushes the version to `main` after a merge, so a clone that has not pulled
  // carries the previous one, and tagging that publishes nothing new. The branch push would
  // then be rejected as a non-fast-forward, reporting a missing `git pull` as a git
  // plumbing failure.
  spawnSync("git", ["fetch", "--quiet", "origin", branch], { stdio: "ignore" });
  const local = ask(["rev-parse", "HEAD"]);
  const remote = ask(["rev-parse", `origin/${branch}`]);
  if (local !== "" && remote !== "" && local !== remote)
    throw new Error(
      `tag-release: ${branch} differs from origin/${branch}; run \`git pull --ff-only\` first`,
    );

  push(["tag", tag]);
  try {
    // The branch goes with the tag because a bump commit is usually still local-only, and
    // publishing a tag whose version bump never reached the remote would fail the
    // workflow's own tag-against-version check.
    push(["push", "origin", branch, "--follow-tags"]);
  } catch (error) {
    // The tag outlives a failed push as a landmine: the retry that fixes connectivity
    // would refuse it as already existing, so the release would need a manual `git tag -d`
    // to get started again.
    push(["tag", "--delete", tag]);
    throw error;
  }
  console.log(`tag-release: pushed ${tag} from ${branch}`);
}

try {
  main();
} catch (error) {
  // A message, not a stack. This is the command a maintainer runs to cut a release, and
  // the three refusals above are ordinary states to hit, not crashes.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
