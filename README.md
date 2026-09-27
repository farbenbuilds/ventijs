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

**ventijs is pre-alpha.** No npm release exists, and an install ships the native
addon for one platform, so `pnpm build:binding` is part of getting it running.

A full round trip works on both routes: a real `ws` client connects to a ventijs
server, sends text and binary, and receives the replies. The framing is a pure Zig
codec behind a Node-API handle, and the transport is Node's, which is the shape
`docs/adr/0001-transport-and-framing-ownership.md` records as the decision.

| Area                                         | State                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Native addon build, load, and engine version | Works. Reports engine 1.7.0 and its HTTP/3 capability                      |
| `WebSocketServer` shape and handshake policy | Works. Construction, options, events, `handleUpgrade`, `verifyClient`      |
| Server-side `WebSocket` record               | Works. Properties, DOM handlers, ready states, exactly-once `close`        |
| `WebSocket` client, `new WebSocket(url)`     | Works. `net` and `tls`, redirects, `ws+unix:`, and a real `ws` peer        |
| `message` and `send`, both directions        | Works on both routes, including fragmentation and `binaryType`             |
| `ping`, `pong`, `autoPong`, control events   | Works. The pong goes out before the application sees the ping              |
| `close` codes, reasons, exactly-once `close` | Works, including 1005 for a code-less close and `closeTimeout`             |
| `binaryType`, `skipUTF8Validation`           | Works. All four values, and the validator is switchable                    |
| `allowSynchronousEvents`, `maxFragments`     | Works. The pause stops the parse loop, as `ws` does                        |
| `createWebSocketStream`                      | Works, compared against `ws`                                               |
| `clientTracking`, `server.options` shape     | Works, property for property against `ws`                                  |
| Per-message deflate                          | Works, on both routes, with `ws`'s negotiation and its 1024-byte threshold |
| Maximum message size                         | `ws`'s 100 MiB default, per connection, honoured                           |
| `maxPayload`, `maxFragments`                 | Enforced per connection, at the option's value, on both routes             |

`perMessageDeflate` uses the pinned engine's own libdeflate, so a message
compressed here is a message the engine's WebSocket route can read, and there is
one DEFLATE in the binary. Both directions always answer
`server_no_context_takeover; client_no_context_takeover`: carrying a deflate window
between messages needs a streaming compressor, the engine's is one-shot, and
declining is always legal and costs compression ratio rather than correctness. A
`*_max_window_bits` below 15 is therefore declined during negotiation rather than
accepted and quietly ignored — `ws` accepts one because its zlib is streaming.

`maxPayload` grows into its ceiling on demand rather than allocating it at open.
A server holding the 100 MiB default for 128 connections would need 12.5 GiB, and a
peer that never sends a message must not cost anything.

The compiled ceiling that remains is the engine route's, 64 KiB, and it is a
property of the build rather than a setting. See
[The 64 KiB message ceiling](#the-64-kib-message-ceiling).

The itemised matrix, with the module and the evidence test behind every row, is
[COMPATIBILITY.md](COMPATIBILITY.md). The mapping from the upstream API
reference to the module that implements each item is
[docs/compliance.md](docs/compliance.md). Moving from `ws` is
[docs/migrating.md](docs/migrating.md).

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

```ts
import { WebSocket, WebSocketServer } from "ventijs";

const server = new WebSocketServer({ port: 8080 });

server.on("listening", () => {
  console.log("listening on", server.address()?.port);
});

server.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    socket.send(isBinary ? data : `echo: ${data.toString()}`);
  });
  socket.on("close", (code, reason) => {
    console.log("closed", code, reason.toString());
  });
});

const client = new WebSocket("ws://127.0.0.1:8080/");
client.on("open", () => client.send("hello"));
client.on("message", (data) => console.log("client saw", data.toString()));
client.on("error", (error) => console.error(error));
```

Both halves of that run against a real `ws` peer in this repository's suites:
`tests/compat/socket/codec-upgrade*.test.ts` drives a ventijs server with a `ws`
client, and `tests/compat/client/**` drives a ventijs client with a `ws` server.

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

| Surface                                              | Status    | Note                                                                                   |
| ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| Package exports, ESM and CJS bundles, declarations   | `done`    | `import` and `require` conditions, `types` under both                                  |
| Native addon build, load, engine version, HTTP/3     | `done`    | ReleaseSafe, Zig 0.16.0                                                                |
| `WebSocketServer` construction, options, events      | `done`    | Including the `WebSocket` class option                                                 |
| `handleUpgrade`, `shouldHandle`, `address`, `close`  | `done`    | Node HTTP upgrade path                                                                 |
| `verifyClient`, `handleProtocols`, `wsClientError`   | `done`    | Hardened beyond `ws`, divergence documented                                            |
| `createWebSocketStream`                              | `done`    | Duplex adapter, compared against `ws`                                                  |
| Server-side `WebSocket` properties and DOM handlers  | `done`    | Ready states, `binaryType`, `addEventListener`, `on*`                                  |
| `WebSocket` client construction                      | `done`    | `net` and `tls`, redirects, `unexpected-response`, `ws+unix:`                          |
| Inbound text and binary messages                     | `done`    | Both routes, with a real `ws` peer on each                                             |
| Fragmented messages                                  | `done`    | `send`'s `fin` reads, and continuations carry opcode 0                                 |
| Outbound `send` and `bufferedAmount`                 | `done`    | `binary` and `fin` both reach the wire                                                 |
| `ping`, `pong`, and their events                     | `done`    | Automatic pong precedes the application event                                          |
| Close codes, reasons, exactly-once `close`           | `done`    | 1005 for a code-less close, `closeTimeout` bounds the handshake                        |
| `binaryType`, `skipUTF8Validation`                   | `done`    | All four values; the validator is switchable                                           |
| `allowSynchronousEvents`, `maxFragments`             | `done`    | The pause stops the parse loop; excess fragments close 1008                            |
| `maxPayload`, `maxFragments`, and `1009`             | `done`    | Enforced per connection, at the option's value                                         |
| `perMessageDeflate`                                  | `done`    | RFC 7692 on both routes; a window below 15 is declined                                 |
| Client `upgrade` event                               | `done`    | `ws`'s payload and order, before the 101 is validated                                  |
| Client `redirect` and `unexpected-response` payloads | `done`    | `ws`'s payloads: the next hop's request, and the request and response                  |
| `finishRequest`                                      | `partial` | Typed and reachable, not on the published surface: `@types/ws` declares no such member |
| RFC 6455 Autobahn suite                              | `done`    | `autobahn.yml`, capacity-scoped at 128 of 517 cases                                    |
| `ws` side-by-side conformance suite                  | `partial` | Every surface above has a compared case; see the matrix                                |

## Protocol conformance, honestly

The Autobahn suite runs in `autobahn.yml` and is a regression gate: the cases the
engine is known to fail are listed in `tests/autobahn/baseline.json`, anything
failing outside that list fails the run, and a listed case that starts passing also
fails the run until the list is shortened.

The latest recorded run, `36287763043`, over the 301-case framing selection. These
numbers are from that run and are not recomputed on every build: the selection is
derived from `engineLimits().messageBytes`, which has since moved from 32 KiB to
64 KiB, and three entries in `tests/autobahn/baseline.json` are expected to pass now
and are only removed by a run against the digest-pinned client. That run needs
Docker, so the expected-passing entries are marked rather than deleted, and the
gate's own report of a now-passing entry is what flags them.

| Outcome                | Cases | Meaning                                             |
| ---------------------- | ----- | --------------------------------------------------- |
| Passed                 | 248   | Conformant                                          |
| Failed                 | 9     | Tracked in `tests/autobahn/baseline.json`, by cause |
| Skipped, over capacity | 44    | Above the 64 KiB message ceiling below              |

The first run of the suite, on commit `47bfc68`, had 160 passing and 229 failing.
The nine that remain are six in group 1 closed with 1009 where an echo is expected,
two fragment-boundary cases in group 5, and `7.1.1` sending 1001 where the suite
expects 1007. The two per-message-deflate groups are 132 more, carried over from
the run that covered them: `permessage-deflate` is normalised and never
negotiated, and it is UNIMPLEMENTED for want of one struct field on the engine's
route registration.

**Four of the five causes this table used to record do not survive a reading of the
pinned engine.** The incremental UTF-8 decoder, fragment reassembly, the 1007
rejection, the close handshake, and the deflate codec are all present and correct
in the vendored `uWebZockets` tree, and its own Autobahn target enables the
extension on the same route ventijs uses. `COMPATIBILITY.md` has the code, the
per-group recipe, and why none of it can land without a recorded run: the gate
fails a run whose baseline lists a case that now passes, so every protocol fix must
ship with a regenerated baseline, and the baseline can only be recorded by the
digest-pinned suite, which is a frozen Python 2.7 image and needs Docker.

The suite step also used to take 35 minutes, and it was slow for the same reason
the failures were slow: the per-case `duration` the report carries sums to 12
seconds across all 301 cases, because it excludes the connect and the opening
handshake the client does per case. The 2100s was 229 failing cases waiting on
the client's close-handshake timeout. The suite step is now 14s and the job's
remaining cost is the 175s addon build. The per-group breakdown is in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) and in the baseline file itself, so the
next person to pick this up does not have to re-derive it from a CI log.

## The 64 KiB message ceiling

The engine route is compiled with `message_capacity = 64 * 1024` in
`src/engine/server/capacities.zig`. It is a `comptime` constant baked into the
addon, so it is a property of the build rather than a runtime setting. The same
constant sizes the cluster inbox payload slot, so it caps a single message on
both sides of the engine route.

64 KiB is the Autobahn suite's largest group-1 payload, so nothing the suite asks
for is above it. A larger frame is closed by the engine with code `1009` and the
reason `Message too large`, and the probe in the Autobahn harness measures
exactly that close and records it in `tests/autobahn/reports/summary.json`. The
harness reads the number out of `engineLimits().messageBytes` rather than
restating it, which is why raising the constant moved the derived capacity model
with it instead of invalidating it.

The codec route is not bound by this constant. A per-connection `maxPayload` is
honoured up to 100 MiB, growing into its ceiling on demand. `ws` accepts
104857600 bytes by default, so on that route there is no divergence left to
report; what remains is the memory cost of a caller who asks for it, which is
proportional to what the connection actually sends.

There is a second limit, and it is a count rather than a size. The engine has no
hook for stopping a read when its consumer falls behind, so the inbound ring is
the only place a burst can be absorbed. It holds 64 messages
(`inbound_slots` in `src/engine/server/instance.zig`), and a peer that delivers
more than that before the Node main thread drains has the excess dropped and
counted by `serverDroppedMessages`. `ws` applies backpressure instead, so it does
not have this cliff. `tests/binding/socket-echo.test.ts` pins both sides of it.
`serverDroppedMessages` counts one other thing: a message from a connection an
application has paused, which the engine discards because the pinned engine has
no per-connection read pause to stop it reading. Both are a peer outrunning the
consumer, which is what the number is for.

Two harnesses account for it rather than working around it:

- the Autobahn gate reports 128 of the 517 selected cases as
  `skipped-capacity`, with the byte size and this limit, leaving 389 evaluated;
- the benchmark payload matrix stops at 64 B, 1 KiB, 16 KiB, and 64 KiB, and
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
