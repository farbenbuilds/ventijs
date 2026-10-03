# Performance

ventiws ships a benchmark harness that measures the public facade against the
libraries developers actually compare it with: `ws`, `uWebSockets.js`, and
Socket.IO. This document explains what the numbers mean, how to reproduce them,
and where the durable history lives.

## What is measured

The workload is a lock-step echo: one message is sent, the reply is awaited,
the next message is sent. A sample is 200000 round trips at one payload size,
and the payload matrix is 64 B, 1 KiB, 16 KiB, and 32 KiB. Compression is off
on every leg, so the measurement is transport and framing, not deflate.

Every sample runs in a fresh `cluster` worker. A leg cannot inherit another
leg's JIT state, a crashed leg takes down one sample instead of the run, and a
worker that cannot start is reported as `unavailable` rather than as a zero.

The plan interleaves the legs by repeat instead of running one leg to
completion first, so host drift over the run reaches every leg in the same
proportions. One full warm-up repeat per configuration runs and is discarded;
the reported number is the median of three measured repeats.

### The legs

| id               | server                     | client           | what the row isolates                        |
| ---------------- | -------------------------- | ---------------- | -------------------------------------------- |
| `ws`             | `ws` `WebSocketServer`     | `ws`             | the compatibility baseline                   |
| `ventiws`        | the public facade          | `ws`             | the candidate: Zig codec over Node transport |
| `ventiws-engine` | the native engine listener | `ws`             | the threaded engine route as a reference     |
| `uWebSockets.js` | uWebSockets.js v20         | `ws`             | a native uSockets stack, no Node `http`      |
| `socket.io`      | Socket.IO v4               | socket.io-client | an application protocol over websocket       |

`ws`, the facade, and `uWebSockets.js` share the same `ws` client, so the server
is the only variable between those rows. Socket.IO pairs its own client and is
forced to its websocket transport on both sides (`transports: ["websocket"]`,
`allowUpgrades: false`). Engine.IO and Socket.IO framing still ride on every
message: an `emit` with a binary payload costs a JSON packet plus a binary
attachment frame in each direction where raw `ws` costs one frame. That
overhead is the row's subject, and the report says so. The `wire` column counts
payload bytes only on every leg, so it excludes that framing.

### Why the facade is the candidate

The public `ws` surface uses the codec route: Node owns the transport and a Zig
frame codec owns the framing on the Node thread (`CODEBASE.md`, and
[docs/adr/0001](adr/0001-transport-and-framing-ownership.md)). That is what a
consumer runs, so it is what the gate reads. The engine route binds µWebZockets'
own listener and crosses an engine thread per message; the public surface
cannot use it, and it is kept as a reference row so the cost of that boundary
stays visible in every report.

## Running it

```sh
pnpm install
pnpm build          # builds the addon and the bundle the facade leg loads
pnpm bench          # the full five-leg matrix
pnpm bench --gate   # exit non-zero when ventiws is below 90 percent of ws
```

The full matrix takes a few minutes on a quiet host. For a quick local loop,
select legs and shrink the workload:

```sh
pnpm bench --implementations=ws,ventiws --messages=20000 --repeats=2
```

| flag                    | meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `--implementations=...` | comma-separated legs; default is all five                     |
| `--sizes=...`           | payload matrix in bytes; default 64,1024,16384,32768          |
| `--messages=<count>`    | round trips per sample; default 200000                        |
| `--repeats=<count>`     | measured repeats per configuration, at least 2; default 3     |
| `--warmups=<count>`     | full-workload repeats discarded before measuring; default 1   |
| `--report=<path>`       | report path; default `bench/results/report.json`              |
| `--gate`                | apply the verdict; without it the gate is printed but ignored |

A payload above 32 KiB is refused rather than compared: that is the pinned
engine's compiled `message_capacity`, and a row above it would measure a
capability ventiws lacks, not a speed. `uWebSockets.js` defaults to a 16 KiB
payload limit, so the harness raises it to the matrix maximum on that leg.

## Reading a report

The harness prints a Markdown table and writes the same numbers, plus every raw
sample, to `bench/results/report.json`. A leg that produced no number is `n/a`
with the reason in the notes; nothing is extrapolated.

- `median s` is the median wall time of the measured repeats. Handshake and
  connect sit outside the clock; only the round trips are timed.
- `round trips/s` is the median rate. `vs ws` is that rate divided by the `ws`
  rate at the same payload.
- `wire` is `payload bytes x 2 x messages / seconds`, so both directions count.
- A sample spread above 10 percent is called out in the notes: the host was not
  quiet and the median should not be cited as evidence.

The report header carries the provenance a reader needs to compare runs: the
commit, toolchain and dependency versions, lockfile digest, CPU model and
count, and the fairness notes. Absolute numbers are only comparable within a
matching runner and toolchain cohort; the ratio to the same-host `ws` baseline
is the durable claim.

### The 64 B row

This shape measures round-trip latency, so the facade's per-message boundary
cost is at its largest at 64 B and amortizes as the payload grows. In the
v2 history the facade sits near the 90 percent gate at 64 B and at or above
parity from 1 KiB up, leading `ws` by more than 20 percent at 32 KiB. A
JavaScript lock-step echo cannot show a native stack's throughput advantage
either: uWebSockets' own benchmark notes that a JS client cannot saturate
uWebSockets.js. Near-uWS absolute throughput needs a pipelined or
multi-connection shape, which is deliberately not this series.

## The durable history

A benchmark number is only useful if it can be traced to a run. Every trusted
run on `main` publishes an immutable record to the repository's
[`benchmark-data`](https://github.com/farbenbuilds/ventiws/tree/benchmark-data)
branch:

- `records/<year>/<record-id>.json`: the canonical record, with every median,
  raw sample, the runner, the toolchain, and the exact contract digest.
- `raw/<year>/<record-id>/report.json`: the full harness report.
- `index.json` and `latest.json`: the active series, with earlier series
  archived as `index-<benchmark-id>.json`.
- `README.md`: a generated summary with the latest per-payload results.
- `contracts/` and `schema/`: the frozen benchmark definition and its JSON
  schema.

The contract in `bench/contracts/echo_throughput_v2.env` is the frozen
definition of the active benchmark. The publisher refuses a report whose
parameters drifted from it, so a record's methodology columns cannot disagree
with the contract hash they carry. Changing a parameter means a new benchmark
ID and a new history series.

`perf.yml` runs on pushes to `main` that touch the engine or the harness, on a
nightly schedule, and on manual dispatch. The compare job runs with a read-only
token and uploads the report as an artifact on every run, including failures.
The separate `publish-history` job holds `contents: write` and runs only for
non-pull-request events on `main`; it checks out the trusted revision, appends
the record, and pushes as `github-actions[bot]`. Pull-request runs keep their
artifact but can never write history, and an existing record ID with different
content is refused. The gate is recorded, not enforced in CI: a failing run
still publishes its evidence, exactly as the local `--gate` flag is opt-in.

## Adding an implementation

Add the id to `ImplementationId`, `IMPLEMENTATION_LABELS`, and the reference
list in `bench/echo/echo-types.ts`, then add its factory to the record in
`bench/echo/implementation.ts` and an adapter under
`bench/echo/implementations/`. The label map, the factory map, and the leg
totality in `bench/support/summary.ts` are total over the id union, so a missing
entry fails typecheck. Adding a leg to the frozen contract is a new benchmark
series, not an edit.

## Citing numbers

- Cite the same-host `ws` baseline with every number; never a bare absolute.
- Include the report's provenance (commit, toolchain, host) or link the
  benchmark-data record.
- Label estimates as estimates, and treat a run whose spread exceeded 10
  percent as a retry, not a result.
