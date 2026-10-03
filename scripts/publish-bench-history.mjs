#!/usr/bin/env node
// Publishes one benchmark report to a benchmark-data checkout. The workflow
// runs it only for trusted main revisions and passes the provenance it cannot
// read from the report: the workflow run, the runner image, and the kernel.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { publishRecord } from "./bench-history.mjs";
import { buildRecord } from "./bench-record.mjs";

const readArgs = (argv) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error(`expected --flag value, received "${flag ?? ""}"`);
    }
    args.set(flag.slice(2), value);
  }
  return args;
};

const required = (args, key) => {
  const value = args.get(key);
  if (value === undefined || value === "") throw new Error(`missing --${key}`);
  return value;
};

const readFile = (path) => readFileSync(path, "utf8");

const main = () => {
  const args = readArgs(process.argv.slice(2));
  const reportPath = required(args, "report");
  const reportSource = readFile(reportPath);
  const contractPath = required(args, "contract");
  const contractSource = readFile(contractPath);
  const schemaPath = required(args, "schema");
  const contractDocPath = required(args, "contract-doc");
  const record = buildRecord({
    report: JSON.parse(reportSource),
    contractSource,
    recordedAt: new Date().toISOString(),
    workflow: {
      repository: required(args, "repository"),
      eventName: required(args, "event-name"),
      gitRef: required(args, "git-ref"),
      commitSha: required(args, "commit-sha"),
      workflowRunUrl: required(args, "workflow-run-url"),
      runId: Number(required(args, "run-id")),
      runAttempt: Number(required(args, "run-attempt")),
      runnerOs: required(args, "runner-os"),
      runnerArch: required(args, "runner-arch"),
      runnerName: required(args, "runner-name"),
      runnerImage: required(args, "runner-image"),
      kernel: required(args, "kernel"),
    },
  });
  const recordId = publishRecord({
    record,
    reportSource,
    historyDirectory: required(args, "history"),
    contractSource,
    contractName: basename(contractPath),
    schemaSource: readFile(schemaPath),
    schemaName: basename(schemaPath),
    contractDocSource: readFile(contractDocPath),
  });
  process.stdout.write(`${recordId}\n`);
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`publish-bench-history: ${message}\n`);
  process.exitCode = 1;
}
