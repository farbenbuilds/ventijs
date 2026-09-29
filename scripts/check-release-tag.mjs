#!/usr/bin/env node
// Refuses a release whose tag and manifest disagree.
//
// The version advances on merge and the tag is pushed at release time, so the two are
// written by different steps. npm publishes under the manifest's version whatever the tag
// says, so a tag that disagrees would put a version on the registry whose tag, commit
// message, and changelog all name something else, and the mismatch would only be visible
// afterwards.

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
