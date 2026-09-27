<p align="center">
  <img src="misc/ventijs_banner.png" alt="ventijs banner" />
</p>

# ventijs

ventijs is a WebSocket implementation for Node.js with the API of
[`ws`](https://github.com/websockets/ws), delivered as a native addon. The
protocol engine is [µWebZockets](https://github.com/farbenbuilds/uWebZockets), a
Zig engine written for this project and reached through
[`napi-zig`](https://github.com/yuku-toolchain/napi-zig). The public surface,
the types, and every argument check live in TypeScript.

`ws` is the compatibility contract. Every behaviour ventijs claims to implement
is defined by `ws` 8.21.3, the MIT-licensed implementation written by the `ws`
authors, and this project reproduces its observable behaviour rather than its
source. ventijs is not affiliated with the `ws` project, and no `ws` source code
is vendored into it. The upstream API reference is vendored as the pinned
contract, credited at the top of [docs/ventijs.md](docs/ventijs.md) and recorded
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Its body is the upstream
`doc/ws.md` byte for byte, apart from the title.

## Project status

**ventijs is pre-alpha. Do not deploy it, and do not treat it as a drop-in
replacement for `ws` yet.** No npm release exists.

A handshake completes: a real `ws` client connects to a ventijs server. The
message path does not. What exists and what does not:

| Area                                         | State                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Native addon build, load, and engine version | Works. Reports engine 1.7.0 and its HTTP/3 capability                 |
| `WebSocketServer` shape and handshake policy | Works. Construction, options, events, `handleUpgrade`, `verifyClient` |
| Server-side `WebSocket` record               | Works. Properties, DOM handlers, ready states, exactly-once `close`   |
| `createWebSocketStream`                      | Works, subject to the message path below                              |
| Client construction, `new WebSocket(url)`    | **Throws `ERR_INVALID_STATE`.** There is no client                    |
| Inbound `message` event                      | **Never fires.** No inbound message callback on either route          |
| Outbound `send`                              | **Reaches no wire on either route**                                   |
| `ping`, `pong`, and their events             | Arguments are validated, then the missing transport is reported       |
| Per-message deflate                          | Options are normalised, then never negotiated                         |
| Maximum message size                         | **32 KiB**, compiled into the engine rather than configured           |

The rows in bold share two missing pieces. No route decodes an inbound frame:
the engine's WebSocket route registers `open` and `close` callbacks and no
message callback, and the compatibility server adopts the upgraded socket
without ever reading from it. No route writes an outbound frame either: the
staging ring has no engine-thread drain, and a socket from the upgrade path has
no native transport attached, so its `send` reports `ERR_INVALID_STATE` instead
of staging. ventijs therefore cannot echo a message end to end: a `ws` client
connects and then waits. The Autobahn probe records that shape directly,
`handshake: true` alongside `echo: false`.

A second limit is fixed for the lifetime of a build: a message is capped at
32 KiB, where `ws` defaults to 100 MiB. See
[The 32 KiB message ceiling](#the-32-kib-message-ceiling).

The itemised matrix, with the module and the evidence test behind every row, is
[COMPATIBILITY.md](COMPATIBILITY.md). The mapping from the upstream API
reference to the module that implements each item is
[docs/compliance.md](docs/compliance.md).

## Architecture at a glance

```text
TypeScript public surface (ws-compatible, generated types)
        |
        v
typed N-API binding (napi-zig, free functions over explicit state)
        |
        v
Zig procedural engine (DOD slabs, SIMD transforms, guard-clause control flow)
        |
        v
µWebZockets core (libxev I/O, RFC 6455 state machine, bounded queues)
```

The diagram describes ownership, not a working message path. The layers are
built, the addon links the full engine, and the server lifecycle runs on it;
the two edges that would carry a message, the engine-to-JavaScript callback and
the engine-thread write drain, are the work that is outstanding. The TypeScript
layer owns API shape, argument validation, and the generated `.d.ts` surface.
The Zig layer owns buffer lifetime, parsing, framing, and backpressure. Nothing
crosses the boundary by pointer without an explicit borrow contract; see
[CODEBASE.md](CODEBASE.md).

## Install

Published usage, once a release lands:

```sh
pnpm add ventijs
```

From source:

```sh
git clone git@github.com:farbenbuilds/ventijs.git
cd ventijs
nix develop
pnpm install
pnpm build
```

`nix develop` pins Node.js, pnpm, and Zig 0.16.0. The first `pnpm build` compiles
the engine's vendored C dependencies into `.zig-cache/`, which takes minutes and
about a gigabyte; later builds are incremental.

## Quick start

The server surface is the part that works today:

```ts
import { WebSocketServer } from "ventijs";

const server = new WebSocketServer({ port: 8080 });

server.on("listening", () => {
  console.log("listening on", server.address()?.port);
});

server.on("connection", (socket) => {
  // Fires today. A "message" handler on this socket is accepted and then never
  // invoked, so an echo loop written against this branch will hang.
  socket.on("close", (code, reason) => {
    console.log("closed", code, reason.toString());
  });
});
```

The client is not available: `new WebSocket(url)` throws `ERR_INVALID_STATE`,
because only server-side sockets are implemented. Every suite and the benchmark
in this repository therefore drive a ventijs server with a real `ws` client, so
the client side of an application stays on `ws` today.

Constructor-shaped exports are plain functions that return explicit state
records; they never use `class`, `this`, or a prototype chain. See
[CODING_CONVENTION.md](CODING_CONVENTION.md).

## Compatibility at a glance

Status vocabulary, shared with [COMPATIBILITY.md](COMPATIBILITY.md):

| Status     | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `done`     | Implemented and covered by a passing evidence test           |
| `partial`  | Exists in a limited form; the note names what is missing     |
| `todo`     | Planned, not implemented                                     |
| `deferred` | Deliberately out of scope until the named prerequisite lands |

| Surface                                             | Status     | Note                                                                     |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| Package exports, ESM bundle, generated declarations | `done`     | Resolved through the `exports` map                                       |
| Native addon build, load, engine version, HTTP/3    | `done`     | ReleaseSafe, Zig 0.16.0                                                  |
| `WebSocketServer` construction, options, events     | `done`     | Including the `WebSocket` class option                                   |
| `handleUpgrade`, `shouldHandle`, `address`, `close` | `done`     | Node HTTP upgrade path                                                   |
| `verifyClient`, `handleProtocols`, `wsClientError`  | `done`     | Hardened beyond `ws`, divergence documented                              |
| `createWebSocketStream`                             | `done`     | Duplex adapter, compared against `ws`                                    |
| Server-side `WebSocket` properties and DOM handlers | `done`     | Ready states, `binaryType`, `addEventListener`, `on*`                    |
| `WebSocket` client construction                     | `deferred` | Throws `ERR_INVALID_STATE`                                               |
| Inbound text and binary messages                    | `partial`  | Engine route round-trips both; the upgrade route still does no framing   |
| Fragmented messages                                 | `todo`     | `send` does not yet read the `fin` option                                |
| Outbound `send` and `bufferedAmount`                | `partial`  | Engine route reaches the wire; upgrade route reports `ERR_INVALID_STATE` |
| `ping`, `pong`, and their events                    | `partial`  | Arguments validated, control-frame transport missing                     |
| Close codes, reasons, exactly-once `close`          | `partial`  | Argument handling compared with `ws`; `close` latched before dispatch    |
| `maxPayload` and `1009`                             | `partial`  | Normalised but never read; the engine's 32 KiB cap applies               |
| `perMessageDeflate`                                 | `partial`  | Normalised, never negotiated                                             |
| `server.clients` and `server.options` shape         | `partial`  | `clients` always present; three option keys are missing                  |
| RFC 6455 Autobahn suite                             | `done`     | `autobahn.yml`, capacity-scoped at 128 of 517 cases                      |
| `ws` side-by-side conformance suite                 | `partial`  | Upgrade, close, stream, and options; message cases pending               |

## Protocol conformance, honestly

The Autobahn suite ran end to end in CI on the first full attempt. The result:

| Outcome                | Cases | Meaning                                             |
| ---------------------- | ----- | --------------------------------------------------- |
| Passed                 | 160   | Conformant                                          |
| Failed                 | 229   | Tracked in `tests/autobahn/baseline.json`, by cause |
| Skipped, over capacity | 128   | Above the 32 KiB message ceiling below              |

The 229 failures are the largest single source of remaining work, and they are
not evenly spread: 132 are `permessage-deflate`, which is normalised and never
negotiated; 76 are UTF-8 handling; 21 are fragmentation, limits, and close
edges. The per-group breakdown and its reasoning are in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) and in the baseline file itself, so the
next person to pick this up does not have to re-derive it from a CI log.

## The 32 KiB message ceiling

The engine is compiled with `message_capacity = 32 * 1024` in
`src/engine/server/capacities.zig`. It is a `comptime` constant baked into the
addon, so it is a property of the build rather than a runtime setting, and
`maxPayload` does not change it. The same constant sizes the cluster inbox
payload slot, so it caps a single message on both sides.

A 64 KiB frame is closed by the engine with code `1009` and the reason
`Message too large`. The probe in the Autobahn harness measures exactly that
close and records it in `tests/autobahn/reports/summary.json`. `ws` accepts
104857600 bytes by default, 3200 times the engine's cap, so this is a real
divergence rather than a tuning difference.

There is a second limit, and it is a count rather than a size. The engine has no
hook for stopping a read when its consumer falls behind, so the inbound ring is
the only place a burst can be absorbed. It holds 64 messages
(`inbound_slots` in `src/engine/server/instance.zig`), and a peer that delivers
more than that before the Node main thread drains has the excess dropped and
counted by `serverDroppedMessages`. `ws` applies backpressure instead, so it does
not have this cliff. `tests/binding/socket-echo.test.ts` pins both sides of it.

Two harnesses account for it rather than working around it:

- the Autobahn gate reports 128 of the 517 selected cases as
  `skipped-capacity`, with the byte size and this limit, leaving 389 evaluated;
- the benchmark payload matrix stops at 64 B, 1 KiB, 16 KiB, and 32 KiB, and
  refuses a larger size with an error naming the source of the ceiling.

Raising it is an engine change with a memory cost, and it is on the list of work
rather than a configuration step.

## Verification

```sh
pnpm build                              # addon plus dist/; both harnesses need it
pnpm test                               # vitest; rebuilds the addon first
pnpm test:compat                        # the ws side-by-side conformance suite
pnpm test:autobahn                      # node tests/autobahn/run.ts; needs Docker
pnpm bench                              # node bench/index.ts; add -- --gate to enforce
```

A single suite runs with `pnpm exec vitest run tests/<file>.test.ts`, and the
Zig units run with `zig build test`. The two harnesses are entry points run by
`node` on `.ts` files through Node's native type stripping, with no loader shim,
and `pnpm test:autobahn` and `pnpm bench` are the pnpm aliases for the
invocations shown. `tsconfig.json` sets `allowImportingTsExtensions` so `tsc`
accepts the `.ts` import specifiers the harnesses use. Both are CI jobs:
`autobahn.yml` and `perf.yml`.

Both measure the engine's real behaviour rather than a claimed one:

- the benchmark drives `ws` and the ventijs native engine through one shared
  echo path, so the server is the only variable. It reports both legs as
  numbers. `--gate` exits non-zero when ventijs falls more than ten per cent
  behind `ws`, and also when a configuration produced no number, because a
  configuration that was never measured cannot be shown to pass;
- the Autobahn runner starts `tests/autobahn/target.ts`, probes whether the
  target can echo at all, and only then starts the fuzzing client, so a target
  that cannot echo costs seconds instead of a half-hour of timeouts. It writes
  its report and JSON summary on every exit path, so a failed run can still be
  inspected. It runs on Node, deliberately: Deno is a better fit for a harness
  that spawns a server and Docker, and it was tried, but the engine's event loop
  does not serve a connection under Deno even though the addon loads and the
  threadsafe function delivers events. `CI_CD_PIPELINE.md` has the measurement;
- the conformance job only starts for a change to the engine, its build
  manifest, the harness, or the lockfile, and a pull request selects 301 of the
  517 cases, which is about 21 minutes instead of 35. The two per-message-deflate groups are 216 cases that all report
  `UNIMPLEMENTED` because deflate is never negotiated, so they run on the weekly
  schedule instead. The suite costs about four seconds a case inside the Python
  fuzzing client while the target answers a connect, echo, and close in 0.42 ms,
  so the only lever is selecting fewer cases;
- the conformance gate is a **regression** gate, not a pass/fail wall. The first
  full run had 160 of 389 evaluated cases passing; the 229 failures are committed
  to `tests/autobahn/baseline.json` with a reason per group. A failure outside
  that list fails the run, so nothing regresses quietly, and a list entry that
  starts passing is reported until it is removed, so the list can only shrink.

## Performance

ventijs makes no throughput claim in this file, and no number appears in it. The
methodology is fixed so that runs are comparable rather than quotable:

- both legs run on the same host and are driven by the same `ws` client, because
  the ventijs client cannot be constructed, so the server implementation is the
  only variable between the two rows;
- three measured repeats follow one discarded warm-up, and the median of the
  repeats is the reported figure;
- `--gate` fails below 90 per cent of the `ws` median. Ten per cent is wider
  than the run-to-run spread of a quiet shared runner and narrower than a change
  a reader would notice;
- a configuration with no measured number is reported `unavailable` with the
  reason, and counts as a failure under `--gate`, never as a skip.

Every report carries its own provenance: commit, dirty flag, Node.js, pnpm, Zig,
lockfile hash, CPU model, and total memory. `perf.yml` uploads the raw report on
every run, including failures.

**The `perf.yml` job does not pass `--gate`.** The first run against a working
engine drain put ventijs between 0.14 and 0.38 of `ws` on a shared
`ubuntu-24.04` runner, and between 0.57 and 0.66 of `ws` on an idle workstation;
the shared runner is several times slower for both legs, so the ratio is the
stable figure and the absolute numbers are not. Gating on that would report the project's
honest starting point as a regression against itself on every pull request and
would train contributors to ignore the job, so the job reports and the verdict
is read from the artifact. Enabling the gate is one flag on the `Measure` step,
and it belongs there when the engine reaches parity. See
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) for the reasoning and the numbers.

## Documentation

| Document                                                         | Contents                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [COMPATIBILITY.md](COMPATIBILITY.md)                             | Parity tracker: every surface item, its owner module, its status, and its evidence test   |
| [docs/compliance.md](docs/compliance.md)                         | Index for the API surface map: the status vocabulary and the evidence rule                |
| [docs/compliance-api.md](docs/compliance-api.md)                 | `WebSocketServer` and `WebSocket` items mapped to modules and status                      |
| [docs/compliance-error-codes.md](docs/compliance-error-codes.md) | The 12 `WS_ERR_*` codes and the environment variables, with reachability                  |
| [docs/ventijs.md](docs/ventijs.md)                               | The vendored upstream `ws` API reference (`doc/ws.md`); the pinned compatibility contract |
| [CODEBASE.md](CODEBASE.md)                                       | Repository layout, binding architecture, data flow, ownership rules                       |
| [CODING_CONVENTION.md](CODING_CONVENTION.md)                     | TypeScript and Zig style, anti-OOP rules, naming, module budget                           |
| [CONTRIBUTE.md](CONTRIBUTE.md)                                   | Environment setup, the script contract, checks, testing, pull requests, releasing         |
| [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md)                           | Workflows, native matrix, conformance, Autobahn gate, benchmark, publishing               |
| [SECURITY.md](SECURITY.md)                                       | Threat model, security boundaries, resource limits, private reporting                     |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)                 | Licence and revision provenance for everything runtime, vendored, or CI-only              |
| [SKILL.md](SKILL.md)                                             | Agent engineering skill: ownership, boundary contract, working method                     |

## License and credits

MIT. See [LICENSE](LICENSE).

- [`ws`](https://github.com/websockets/ws) is copyright Einar Otto Stangvik,
  Arnout Kazemier, and contributors, MIT-licensed. ventijs targets its
  observable behaviour and vendors its API reference for reference only.
- µWebZockets is the first-party MIT-licensed protocol engine, written for this
  project.
- The [Autobahn testsuite](https://github.com/crossbario/autobahn-testsuite),
  copyright typedef int GmbH, Apache-2.0, is a CI-only tool pulled by digest.
  It is never shipped in the package.
