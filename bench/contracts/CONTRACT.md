# Echo Throughput Guarantee v1

`echo-throughput-v1` is the reproducible performance contract for the lock-step
websocket echo path. The machine-readable parameters live in
`echo_throughput_v1.env`; changing any parameter requires a new benchmark ID,
schema, and history series.

## Guarantee

For every durable record, the ventiws median round trips per second must be at
least 90 percent of the `ws` median at every payload size in the matrix:

```text
ventiws_median_rps >= ws_median_rps * 0.90
```

`uWebSockets.js` and `Socket.IO` are recorded as reference rows and never
decide the verdict. A payload size where either gate leg produced no number
counts as a failure, not as a skip.

## What is measured

Four server implementations run one shared lock-step echo workload: 200000
round trips per sample at 64 B, 1 KiB, 16 KiB, and 32 KiB, with
permessage-deflate disabled everywhere. Every sample runs in a fresh cluster
worker so no leg inherits another's JIT state; one full warm-up repeat per
configuration is discarded and the reported number is the median of three
measured repeats.

`ws`, ventiws, and `uWebSockets.js` share the same `ws` client, so the server
is the only variable between those rows. Socket.IO pairs its own client and is
forced to its websocket transport, so its row is an application-stack
measurement that includes Engine.IO and Socket.IO framing. The `wire` column
counts payload bytes in both directions on every leg and therefore excludes
that framing.

The guarantee is relative, not an absolute capacity claim. Shared-runner
hardware and scheduling vary over time. Every durable record therefore stores
the runner image, CPU, kernel, tool versions, source revision, lockfile digest,
raw samples, and the exact contract checksum. Absolute results should only be
compared within matching runner and toolchain cohorts.

## Durable history

Scheduled, pushed, and manually dispatched runs on `main` publish immutable
records to the repository's `benchmark-data` branch. That branch contains:

- `records/<year>/<record-id>.json` for canonical structured results;
- `raw/<year>/<record-id>/report.json` for the full report with raw samples;
- `index.json` and `latest.json` for automated consumers;
- a generated `README.md` summary; and
- the exact v1 contract, its parameters, and the JSON schema describing each
  record.

The branch is append-only at the record level: publication fails if an existing
record ID has different content, and re-publishing identical content is
idempotent. Pull-request runs keep the same report as a workflow artifact but
never receive history-branch write permission.

## Reproduction

Enter the checkout, build the addon, and run the matrix:

```sh
pnpm install
pnpm build
pnpm bench
```

`pnpm bench --gate` applies the verdict locally and exits non-zero when the
guarantee fails. The report lands in `bench/results/report.json` with the
provenance needed to compare it against this history.
