#!/usr/bin/env node
// Refuses a release whose tag and manifest disagree.
//
// `pnpm release` bumps `package.json` and tags `v<version>` together, so the two are the
// same string by construction and this never fires. It exists for the tag pushed by
// hand, where npm would publish under the manifest's version while the tag, the commit
// message, and the changelog all say something else, and the mismatch is only visible
// afterwards on the registry.

import { readFileSync } from "node:fs";

const TAG_PREFIX = "refs/tags/v";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const ref = process.env.GITHUB_REF ?? "";

if (!ref.startsWith(TAG_PREFIX)) {
  throw new Error(`check-release-tag: GITHUB_REF is ${ref}, which is not a v-tag`);
}
const tag = ref.slice(TAG_PREFIX.length);
if (tag !== version) {
  throw new Error(`check-release-tag: the tag is v${tag} but package.json is ${version}`);
}
console.log(`check-release-tag: v${tag} matches package.json`);
