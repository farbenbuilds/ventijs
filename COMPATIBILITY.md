# ws Compatibility Matrix

ventijs targets 1:1 observable behavior and types with `ws` plus `@types/ws`
8.18.1, which is the compatibility contract vendored at
[`src/types/ws.d.ts`](src/types/ws.d.ts); the pinned packages are
devDependencies so the conformance suite can run both implementations side by
side. This file is the parity tracker: every public surface item, the module
that owns it, its status, and the test that proves it.

Update the relevant row in the same pull request that implements or changes a
surface. A row is only `done` when its evidence test exists and passes.

Status legend:

- `done` - implemented and covered by the evidence test.
- `partial` - exists in a limited form; the row names what is missing.
- `todo` - planned, not implemented.
- `deferred` - deliberately out of scope until the named prerequisite lands.
- `unreachable` - no counterpart by construction; the row states the architecture
  that removes it.

uWebSockets.js is design inspiration only. None of its API is a public surface
of ventijs.

## Type surface and packaging

| Surface                      | Contract                                                                              | Owner                                             | Status | Evidence                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Named type exports           | Every `@types/ws` ESM named export, plus `WebSocketEventMap` as a documented superset | `src/types/ws.d.ts`, `src/index.ts`               | done   | `tests/types/consumer.ts`                                              |
| `Server` type                | `export { type Server }` in upstream's ESM entry                                      | `src/types/ws.d.ts`, `src/index.ts`               | done   | `tests/types/consumer.ts`                                              |
| Type-only default            | `import type WebSocket from "ventijs"` mirrors `ws`                                   | `src/index.ts`                                    | done   | `tests/types/consumer.ts`                                              |
| Qualified names              | `WebSocket.RawData`, `WebSocket.ServerOptions`, ...                                   | `src/types/ws.d.ts`, `src/compat/constructors.ts` | done   | `tests/types/consumer.ts`                                              |
| Built declaration resolution | Resolves through `exports` as a Node ESM consumer, `skipLibCheck: false`              | `tsconfig.dist-types.json`, `tsdown`              | done   | `tests/declarations/consumer.ts`                                       |
| Runtime values               | Default and named `WebSocket`, `WebSocketServer`, `createWebSocketStream`             | `src/compat/constructors.ts`, `src/index.ts`      | done   | `tests/compat/socket/socket.test.ts`, `tests/declarations/consumer.ts` |

## Event system

| Surface                            | Contract                                                                                                                       | Owner                                                        | Status | Evidence                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------ | -------------------------------------- |
| Duplicate listeners                | `on` keeps duplicates, matching `EventEmitter`                                                                                 | `src/compat/events/registry.ts`                              | done   | `tests/compat/events/registry.test.ts` |
| Removal semantics                  | One occurrence removed per `unsubscribe`; previous registry untouched                                                          | `src/compat/events/registry.ts`                              | done   | `tests/compat/events/registry.test.ts` |
| Dispatch snapshot                  | Handlers added or removed mid-dispatch do not affect the in-flight run                                                         | `src/compat/events/registry.ts`                              | done   | `tests/compat/events/registry.test.ts` |
| Exception propagation              | A throwing handler propagates and skips the remaining handlers                                                                 | `src/compat/events/registry.ts`                              | done   | `tests/compat/events/registry.test.ts` |
| Listener counts and empty dispatch | `listenerCount` and `dispatch` return counts, zero included                                                                    | `src/compat/events/registry.ts`                              | done   | `tests/compat/events/registry.test.ts` |
| `this` binding                     | Listeners are invoked with the emitter as `this`                                                                               | `src/compat/{events/emitter,socket/socket,server/server}.ts` | done   | `tests/compat/events/emitter.test.ts`  |
| Listener leak warning              | `MaxListenersExceededWarning` once per event past the limit; `setMaxListeners(0)` is unlimited                                 | `src/compat/events/limits.ts`                                | done   | `tests/compat/events/limits.test.ts`   |
| `error` with no listeners          | `emit("error")` throws the error; policy lives with the factories                                                              | `src/compat/{events/emitter,socket/socket,server/server}.ts` | done   | `tests/compat/events/emitter.test.ts`  |
| `once` and prepend variants        | `once`, `prependListener`, `prependOnceListener`                                                                               | `src/compat/events/emitter.ts`                               | done   | `tests/compat/events/emitter.test.ts`  |
| Emitter introspection and teardown | `emit`, `removeAllListeners`, `listeners`, `rawListeners`, `eventNames`, `listenerCount`, `getMaxListeners`, `setMaxListeners` | `src/compat/{events/emitter,events/registry}.ts`             | done   | `tests/compat/events/emitter.test.ts`  |

## Socket API (server-side connection)

| Surface                   | Contract                                                                                                           | Owner                                                                                   | Status | Evidence                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Observable properties     | `binaryType`, `bufferedAmount`, `extensions`, `isPaused`, `protocol`, `readyState`, `url`                          | `src/compat/socket/socket.ts`, `src/binding/socket.ts`, `src/engine/socket/socket.zig`  | done   | `tests/conformance/binary-type*.conformance.test.ts`, `tests/compat/socket/socket.test.ts`                                                             |
| Ready-state constants     | `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` on the constructor and the instance                                         | `src/compat/{constructors,ready-state}.ts`                                              | done   | `tests/compat/socket/socket.test.ts`                                                                                                                   |
| Send and frame methods    | `send(data, options?, cb?)`, `ping`, `pong`, `close`, `terminate`, `pause`, `resume`                               | `src/compat/socket/{send,codec-send,lifecycle}.ts`, `src/binding/socket.ts`             | done   | `tests/conformance/send-options.conformance.test.ts`, `tests/conformance/send-fin.conformance.test.ts`, `tests/compat/socket/socket.test.ts`           |
| Node events               | `open`, `message`, `close`, `error`, `ping`, `pong`                                                                | `src/compat/socket/socket.ts`, `src/compat/events/dom-events.ts`, `src/types/socket.ts` | done   | `tests/compat/socket/codec-upgrade*.test.ts`, `tests/compat/socket/server-options-acting.test.ts`                                                      |
| Client-only socket events | `upgrade`, `redirect`, `unexpected-response`, all carrying `ws`'s `ClientRequest` and `IncomingMessage`            | `src/compat/client/{dial,open,redirect,unexpected}.ts`                                  | done   | `tests/compat/client/client-upgrade-event.test.ts`, `tests/compat/client/client-redirect-events.test.ts`, `tests/compat/client/client-refusal.test.ts` |
| DOM handlers              | `onopen`/`onerror`/`onclose`/`onmessage`, `addEventListener`, `removeEventListener`                                | `src/compat/events/{dom-listeners,dom-events}.ts`                                       | done   | `tests/compat/events/dom-listeners.test.ts`                                                                                                            |
| Close reason handling     | `close(code, reason)` mirrors `ws`: string, `Uint8Array`, or absent reason, measured before the type is dispatched | `src/compat/socket/close-reason.ts`                                                     | done   | `tests/conformance/close.conformance.test.ts`                                                                                                          |
| Pause gating              | `pause()` stops event emission until `resume()`                                                                    | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                        | done   | `tests/compat/socket/socket.test.ts`                                                                                                                   |

### Where messages flow today

Node owns the transport and a pure Zig frame codec owns the framing; the split is
recorded as [ADR 0001](docs/adr/0001-transport-and-framing-ownership.md). The engine
carries its own RFC 6455 round trip for the Autobahn and benchmark routes
(`tests/binding/socket-echo.test.ts`), and the upgrade route runs on the codec
through `src/engine/ffi/codec_*.zig` and `src/compat/socket/codec-*.ts`. The client
is the other half of the same decision: `new WebSocket(address)` opens an
`http.ClientRequest`, checks every field of the 101 rather than its status, and
hands the socket to a codec opened in the client role, because a client masks and a
server must not. `http.request` rather than a hand-written request line, because the
three client-only events are its events.

## Engine capacity limits

These are properties of the pinned engine build, not of the facade, and no
JavaScript option can raise them. Each row names the constant that governs it.
The constants live in `src/engine/server/capacities.zig` and are re-exported
from `options.zig`, which owns their validation.

| Limit                  | Value                                       | Governed by                                            | Observable as                                                                                                                                                                            |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound message size   | 64 KiB, the suite's largest group-1 payload | `message_capacity`, `src/engine/server/capacities.zig` | The engine route closes with 1009 above it. The codec route is not bound by it: `maxPayload` and `maxFragments` are per connection and grow into their own ceiling                       |
| Outbound frame size    | 64 KiB                                      | `max_frame_bytes`, same                                | `send` reports `ERR_MAX_PAYLOAD`                                                                                                                                                         |
| Inbound burst          | 64 messages before the consumer drains      | `inbound_slots`, `src/engine/server/instance.zig`      | `serverDroppedMessages` counts all three causes of inbound loss: a refused stage, a message from a paused connection, and a purge of a connection that closed with messages still staged |
| Connections per server | 128                                         | `connection_capacity`, same                            | A connection past the cap is terminated on open                                                                                                                                          |

`ws` defaults `maxPayload` to 100 MiB and vents 500 MiB frames in its own speed
harness, so the message-size rows bound the engine route only. The codec route
enforces a per-connection `maxPayload` up to 100 MiB, growing into it on demand
rather than allocating it at open: a server holding the `ws` default for 128
connections would need 12.5 GiB, and a peer that never sends a message must not
cost anything.

`message_capacity` was raised from 32 KiB to 64 KiB, the suite's largest group-1
payload, which is what the six group-1 cases were failing on. The cost is about
22 MB per live server, because the message slab, the write queue, the RFC 7692
scratch, the cluster inbox, and both staging rings all scale with it. The harness
derives its capacity model from `engineLimits().messageBytes` rather than
restating the number, so raising the constant moves the model with it.

`engineLimits` reports the compiled capacities to JavaScript so the promise these
rows make is checkable rather than restated. A hardcoded TypeScript copy is how the
cap came to be 64 KiB in the engine while a test still asserted 32 KiB and passed.

`pnpm bench` refuses a payload above the ceiling instead of comparing absent
against present, and `tests/autobahn/` reports capacity-blocked cases as
`skipped-capacity` rather than folding them into a pass or a failure.

## Shared with the engine

Neither of these is a ventijs gap; both are the pinned `uWebZockets` build's
behaviour, and declining is the answer the RFC allows.

| Behaviour                                                    | Why it is not a gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFC 7692 context takeover is declined                        | The engine has none either. `compress_message` is a one-shot `libdeflate_deflate_compress` over a whole buffer with no retained history (`zig-pkg/uWebZockets-*/src/ws/deflate.zig:104`), and the 9-to-14-bit window path calls `deflateReset` per message (`zig-pkg/uWebZockets-*/src/ws/deflate.zig:231`), which discards the window. The engine answers `server_no_context_takeover; client_no_context_takeover` unconditionally in its own handshake (`zig-pkg/uWebZockets-*/src/ws/handshake.zig:117`). Declining is legal under RFC 7692 section 7.1.1.1 and costs compression ratio, not correctness |
| A compressed message sent in fragments goes out uncompressed | The engine has no fragmented-send API, so it cannot produce one either. RFC 7692 needs a sync flush at each fragment boundary, which one-shot libdeflate cannot emit, so the codec declines at `may_compress` (`src/engine/codec/rsv1.zig:39`, reached from `src/engine/codec/deflate.zig:40`) and at `mayCompress` (`src/compat/socket/codec-send.ts:71`). The receive side does read one, so a `ws` peer interoperates in both directions                                                                                                                                                                 |

Declining takeover even when a peer offers it is what guarantees every message is
independently inflatable.

`finishRequest` and `generateMask` are implemented and pinned by
`tests/compat/client/client-request-hooks.test.ts`: `finishRequest` runs on the first
dial and on every redirect hop with the caller owning `request.end()`, and
`generateMask` supplies the key the encoder puts on the wire, from four bytes that
live on the socket state so the per-frame call allocates nothing.

## What is still outstanding

| Surface                      | What is missing                                                                                                                                                                                                                                             | Where                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Client redirects             | The `wss:` to `ws:` downgrade (`src/compat/client/redirect.ts:68`) and the hop limit (`src/compat/client/redirect.ts:48`) are implemented and have no test. Following, refusing, and the credential-stripping rule are tested against a hand-answering peer | `tests/compat/client/client-redirect*.test.ts` |
| `origin`, `handshakeTimeout` | Both are read and applied; neither has a behavioural test                                                                                                                                                                                                   | `src/compat/client/{request,dial}.ts`          |

## RFC 6455 conformance

The gate is a regression gate over the cases `tests/autobahn/baseline.json` lists.
A failure outside the list fails the run, and a listed case that starts passing is
reported and fails the run until the list is shortened. Drift is only ever reported
for a listed id, so the gate constrains the listed cases and nothing else: a case
that was never listed and starts passing produces no violation, and no baseline
needs regenerating for it. A listed case that a protocol fix moves does need a
regenerated baseline, which takes one recorded run of the digest-pinned suite on a
Docker-capable host.

**Current state, from `.github/workflows/autobahn.yml` run 36338412316, recorded in
`tests/autobahn/baseline.json`:** 260 of 268 evaluated framing cases passing, 7
non-strict, 8 failed, 33 capacity-blocked.

| Group  | Failing | What the report says                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5      | 2       | `5.19` and `5.20` fail with a clean close and no remote close code, so the frame is delivered and the connection is healthy. Neither reproduces on the current build across 28 stress runs, so the recorded run is older than the build                                                                                                                                                                                                                                       |
| 7      | 1       | `7.1.1` expects an echo and a normal close. The data loss is fixed: a message staged in the same read as a peer close is delivered, and `tests/binding/socket-close-race.test.ts` fails on the previous build and passes on this one. The case still fails for a different reason, because the engine has already closed the transport by the time the echo is written, so the echo cannot be sent, and refusing to write to a closed connection is correct rather than a gap |
| 9      | 8       | Rate rather than conformance: each case sends 1000 messages as fast as the peer will take them, and the suite marks the case failed when the agent cannot sustain the rate. The boundary is the payload size, not the message cap, because group 1's 65536-byte cases pass. The inbound ring holds 64 messages and the Node main thread drains it, so a burst outruns the consumer                                                                                            |
| 12, 13 | 132     | `permessage_deflate` is now genuinely wired on the engine route: `RawConfig.permessage_deflate` in `src/engine/server/options.zig:46` and `.compression = .permessage_deflate` in `src/engine/server/connections.zig:18`. They are still listed, and the next recorded run is what decides                                                                                                                                                                                    |

`permessage_deflate` crosses `NativeServerConfig` in `src/binding/native.ts`,
`RawConfig` and `Limits` in `src/engine/server/options.zig` carry it, and
`attach_route` registers the compression. The pinned engine's own Autobahn target
enables it on the same route:

```zig
// zig-pkg/uWebZockets-1.7.0-.../tests/autobahn/main.zig:19
_ = try app.ws("/", .{
    .message = echo_message,
    .compression = .permessage_deflate,
    .max_frame_size = max_message_size,
});
```

```zig
// src/engine/server/connections.zig:25
_ = try app.ws(target.config.path_slice(), .{
    .open = Trampoline.open,
    .message = Trampoline.message,
    .close = Trampoline.close,
    .compression = compression,
    .max_frame_size = target.config.limits.max_frame_bytes,
    .max_message_size = target.config.limits.max_message_bytes,
});
```

`ServerConfig.compression_stride` is called from `layout_offsets`
unconditionally, so the engine reserved the paired deflate scratch for every
configuration and enabling the extension turns that dead slab into function at no
additional memory.

A PyPI install of the suite is not a substitute for the digest-pinned image: the
published package is a broken Python 2 relic, and a `2to3` port of the `v25.10.1`
source dies in the first case file on `str` versus `bytes` payload semantics.

## WebSocketServer

| Surface                         | Contract                                                                                                                                                                                                                                 | Owner                                                | Status | Evidence                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constructor and listen callback | `new WebSocketServer(options?, callback?)`                                                                                                                                                                                               | `src/compat/server/server.ts`                        | done   | `tests/compat/server/server.test.ts`                                                                                                                                                                                                        |
| Options                         | `host`, `port`, `backlog`, `server`, `noServer`, `path`, `clientTracking`, `verifyClient`, `handleProtocols`, `perMessageDeflate`, `maxPayload`, `maxFragments`, `skipUTF8Validation`, `allowSynchronousEvents`, `autoPong`, `WebSocket` | `src/compat/options/{shared,server}.ts`              | done   | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts`, `tests/compat/server/options-parity.test.ts`, `tests/compat/socket/max-payload.test.ts`, `tests/compat/socket/server-options-acting.test.ts` |
| Observable properties           | `options`, `path`, `clients`                                                                                                                                                                                                             | `src/compat/server/server.ts`, `src/types/server.ts` | done   | `tests/compat/server/server.test.ts`, `tests/compat/server/options-parity.test.ts`, `tests/compat/socket/client-tracking.test.ts`                                                                                                           |
| Methods                         | `address()`, `close(cb?)`, `handleUpgrade()`, `shouldHandle()`                                                                                                                                                                           | `src/compat/server/{server,close,upgrade}.ts`        | done   | `tests/compat/server/{server,upgrade}.test.ts`, `tests/compat/server/routing-parity.test.ts`                                                                                                                                                |
| Events                          | `connection`, `error`, `headers`, `close`, `listening`, `wsClientError`                                                                                                                                                                  | `src/compat/server/{server,listeners,upgrade}.ts`    | done   | `tests/compat/server/{server,upgrade}.test.ts`                                                                                                                                                                                              |
| HTTP server integration         | `noServer` routing, `server` option, `upgrade` wiring with the Node `http.Server`                                                                                                                                                        | `src/compat/server/{upgrade,listeners}.ts`           | done   | `tests/compat/server/upgrade.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                                      |
| Handshake policy                | `verifyClient` sync/async, `handleProtocols`, origin/path checks                                                                                                                                                                         | `src/compat/server/{upgrade,handshake}.ts`           | done   | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                     |
| Rejections                      | `wsClientError` for handshake failures, destroy semantics                                                                                                                                                                                | `src/compat/server/{handshake,upgrade}.ts`           | done   | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                     |

## Stream and client

| Surface                 | Contract                                                                                   | Owner                          | Status | Evidence                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| `createWebSocketStream` | Duplex stream over an open socket                                                          | `src/compat/stream.ts`         | done   | `tests/conformance/stream.conformance.test.ts`, `tests/compat/stream.test.ts`                         |
| Client construction     | `new WebSocket(address, protocols?, options?)`, redirects, `unexpected-response`           | `src/compat/client/**`         | done   | `tests/compat/client/**`, every case against a real `ws` server                                       |
| Client options          | `followRedirects`, `maxRedirects`, `origin`, `headers`, `handshakeTimeout`, `closeTimeout` | `src/compat/options/client.ts` | done   | `tests/compat/client/client-{options,redirect}.test.ts`, `tests/compat/options/normalization.test.ts` |

## Boundary and lifetime invariants

| Invariant                  | Contract                                                                                                                                          | Owner                                                                                                    | Status | Evidence                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retained inbound payloads  | Frames are copied into Node-owned buffers before handlers run                                                                                     | `src/binding/socket.ts`, `src/engine/ffi/socket_pump.zig`                                                | done   | `tests/binding/socket-echo.test.ts`                                                                                                                                                                                                                                                  |
| Borrowed outbound buffers  | Buffers live only for the native call, then land in the bounded queue                                                                             | `src/binding/socket.ts`, `src/engine/socket/{payload,socket}.zig`                                        | done   | `tests/binding/socket.test.ts`                                                                                                                                                                                                                                                       |
| Generation-checked handles | Stale handles produce typed errors, never crashes or use-after-free                                                                               | `src/binding/{handle,server,socket}.ts`, `src/engine/socket/handles.zig`                                 | done   | `tests/binding/server-lifecycle.test.ts`, `tests/binding/socket-boundary.test.ts`                                                                                                                                                                                                    |
| Exactly-once close         | Terminal state is latched before `close` dispatch                                                                                                 | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                                         | done   | `tests/binding/socket-boundary.test.ts`, `tests/compat/socket/socket.test.ts`, `src/engine-tests/socket/socket_test.zig`                                                                                                                                                             |
| Inbound ring reclamation   | A connection that closes with messages staged cannot strand the ring for every other connection                                                   | `src/engine/socket/queues.zig`, `src/engine/ffi/socket_inbound.zig`                                      | done   | `src/engine-tests/socket/inbound_purge_test.zig`                                                                                                                                                                                                                                     |
| Backpressure               | `bufferedAmount` growth plus send callbacks, bounded queues; `send` returns no value, matching `ws`; inbound and outbound loss counted separately | `src/binding/{socket,inbound,server}.ts`, `src/engine/socket/payload.zig`, `src/compat/socket/queued.ts` | done   | `tests/binding/socket.test.ts`, `tests/compat/socket/send-reporting.test.ts`, `tests/compat/client/soak-backpressure.test.ts`                                                                                                                                                        |
| Bounded close handshake    | A close that a peer never answers is torn down at `closeTimeout` and reports 1006, rather than holding a transport and a codec slot indefinitely  | `src/compat/socket/codec-close.ts`                                                                       | done   | `tests/compat/client/client-close-timeout.test.ts`, `tests/compat/socket/codec-upgrade-close-timeout.test.ts`                                                                                                                                                                        |
| Redirect hygiene           | Credentials are carried across a redirect within one origin and dropped across a change of authority, and a `wss:` to `ws:` downgrade is refused  | `src/compat/client/redirect.ts`                                                                          | done   | `tests/compat/client/client-redirect-credentials.test.ts`                                                                                                                                                                                                                            |
| Close code mapping         | `maxPayload` 1009, protocol errors 1002, policy rejections 1008, too many fragments 1008                                                          | `src/protocol/close-codes.ts` (outgoing validation), `src/engine/codec/events.zig` (the mapping)         | done   | `tests/protocol/close-codes.test.ts`, `tests/compat/socket/fragment-bound.test.ts`                                                                                                                                                                                                   |
| Per-message deflate        | RFC 7692 on both routes: option normalization, header negotiation, compression, and inflate                                                       | `src/compat/extensions/{grammar,params,deflate,offer}.ts`, `src/engine/codec/{deflate,inflate,rsv1}.zig` | done   | `tests/compat/extensions/{grammar,deflate,deflate-client}.test.ts`, `tests/compat/socket/permessage-deflate.test.ts`, `tests/compat/socket/deflate-frames.test.ts`, `src/engine-tests/codec/deflate_test.zig`. A window below 15 is declined; no context takeover in both directions |

## Error shape policy

ventijs throws `Error` instances that keep the `ws` constructor (`TypeError`,
`RangeError`, `SyntaxError`) and message text wherever `ws` defines one, and adds
a stable `code` to every error, from `src/types/errors.ts`. The `WS_ERR_*` half of
that union is `ws`'s, and a refused frame now carries one: the codec's
classification crosses the boundary as an ordinal and `ws`'s code, constructor, and
message come out the other side (`src/compat/socket/refusal-table.ts`). The `ERR_*`
half is additive and answers what `ws` reports uncoded;
[compliance-error-codes.md](docs/compliance-error-codes.md) tracks all twelve
`WS_ERR_*` codes and both environment variables. `tests/compat/socket/socket.test.ts`
and `tests/compat/server/upgrade-policy.test.ts` assert the `ERR_*` codes,
`tests/compat/socket/refusal-codes.test.ts` and
`tests/compat/socket/refusal-payload-codes.test.ts` the `WS_ERR_*` ones.

One `WS_ERR_*` condition is only half reachable, and that is the engine rather than a
divergence: `WS_ERR_TOO_MANY_BUFFERED_PARTS` covers both `maxFragments` and
`maxBufferedChunks` in `ws`, and only the first is a bound ventijs has, because the
codec holds at most one read's un-decoded tail against `ws`'s default of 262144.

`close(code, reason)` matches `ws` for every argument shape. Two behaviours
differ and both are deliberate:

- A close `ws` refuses still closes. `ws` latches `CLOSING` before it validates,
  so a bad code or a bad reason leaves the socket closing. ventijs validated
  first, which left it `OPEN` and let a caller retry a close `ws` had already
  accepted as a decision. `tests/conformance/close-latch.conformance.test.ts`
  compares the ready state on both the throwing and the non-throwing path, because
  an error-only comparison cannot see this.
- `reason === null` is treated as an absent reason. `ws` rejects it with a
  V8-internal `TypeError` from reading `.length` off it.

`src/compat/socket/close-reason.ts` refuses a reason that is neither a string nor a
`Uint8Array` once it carries data: a differently typed array reports a smaller
element count than its `byteLength`, so accepting one would size a close frame from
bytes that are never written (GHSA-58qx-3vcg-4xpx). `ws` 8.21.3 refuses the
argument at `sender.js:207`, so this describes the pre-8.20.1 code path.
`tests/conformance/close.conformance.test.ts` pins the argument handling and
`tests/protocol/close-codes.test.ts` the predicates.

A send is reported the way `ws` reports it, which is a split rather than one rule.
A send on a socket that is not `OPEN` goes to `sendAfterClose`: the bytes are
accounted, the callback is told, and nothing else happens. A send that failed on an
_open_ socket goes to `emitErrorAndClose`: `CLOSING` is latched, `error` is emitted
once, and the socket then closes, which is the only path that emits.
`tests/conformance/send-after-close.conformance.test.ts` compares the first half
against `ws` and `tests/compat/socket/send-reporting.test.ts` pins both.

`terminate()` latches `CLOSING` before it destroys, and a `close` or `terminate`
while still `CONNECTING` emits `error` with `WebSocket was closed before the
connection was established` before the 1006 `close`, matching `ws`'s
`abortHandshake`. `tests/compat/socket/lifecycle.test.ts` covers both.

The handshake is hardened beyond `ws` in five places, and all five are
deliberate:

- A `handleProtocols` result that is not a token is refused instead of echoed
  into a response header.
- Control characters in `verifyClient` headers or status codes are dropped before
  the rejection is written.
- A rejection status outside 400-599 is clamped to 500. `ws` writes the literal
  string `HTTP/1.1 700 undefined`.
- An in-range code with no `STATUS_CODES` entry and no caller message is answered
  with an empty body. `ws` throws a `TypeError` out of its `verifyClient` callback
  there, which escapes as an `uncaughtException` and writes nothing to the socket.
  This is a strict improvement, but a consumer relying on `ws` not throwing for a
  valid input would see a difference.
- The socket's handshake-phase `error` handler is removed once the 101 is written,
  which `ws` also does.

`tests/compat/server/upgrade*.test.ts` and
`tests/compat/server/options-parity.test.ts` cover these.

Two more divergences worth naming, both measured against `ws` and both a
superset rather than a mismatch:

- `ws` types `close` as `(code?: number, reason?: string | Buffer)` and
  `ping`/`pong` payloads are validated against RFC 6455's 125-byte control cap
  with a thrown `RangeError`, which ventijs now matches. A fractional reserved
  code such as `1005.5` passes both validators and truncates; `ws` then writes
  1005 to the wire while the engine's own close-code validation refuses 1005 and
  reports `ERR_INVALID_CLOSE_CODE`.
- `@types/ws` declares `readonly path: string` on the server but `ws`'s runtime
  never sets it, so `"path" in server` is false there. ventijs exposes it.
  `server.clients` is the mirror image and is now absent when
  `clientTracking` is falsy, exactly as `ws` leaves it, rather than present and
  `undefined`.

## Verification surface

| Suite                                                                                            | Purpose                                                                                                                                          | Status |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `tests/binding/addon.test.ts`                                                                    | Native build, addon load, engine version round-trip                                                                                              | done   |
| `tests/binding/**`                                                                               | Lifecycle, connection slab, and socket operation boundaries                                                                                      | done   |
| `tests/binding/socket-echo.test.ts`                                                              | End-to-end text, binary, burst, and inbound drop accounting over the engine                                                                      | done   |
| `tests/compat/events/registry.test.ts`                                                           | Listener registry semantics                                                                                                                      | done   |
| `tests/protocol/**`                                                                              | Close code, framing, and backpressure helpers                                                                                                    | done   |
| `tests/compat/**`                                                                                | Facade units, option normalization, and coded error factories                                                                                    | done   |
| `tests/compat/events/emitter.test.ts`                                                            | Listener surface parity with `EventEmitter`, `this` binding, unhandled errors                                                                    | done   |
| `tests/compat/events/dom-listeners.test.ts`                                                      | DOM listeners, attributes, and event object shapes                                                                                               | done   |
| `tests/compat/{socket/socket,server/server,server/upgrade,server/upgrade-policy,stream}.test.ts` | Facade lifecycle and HTTP upgrade policy                                                                                                         | done   |
| `tests/compat/socket/codec-upgrade*.test.ts`                                                     | The upgrade route against a real `ws` peer in both directions                                                                                    | done   |
| `tests/compat/client/**`                                                                         | The client against a real `ws` server: messages, frames, lifecycle, refusals, redirects                                                          | done   |
| `tests/compat/client/soak*.test.ts`                                                              | Repetition, concurrency, and a slow peer, measured for leaks and bounded queues                                                                  | done   |
| `tests/binding/codec*.test.ts`                                                                   | The codec's Node-API surface, including the interop cases that pinned the boundary                                                               | done   |
| `tests/conformance/upgrade.conformance.test.ts`                                                  | Handshake responses compared byte-for-byte against `ws`                                                                                          | done   |
| `tests/conformance/{close-latch,control,send-after-close}.conformance.test.ts`                   | Latching, control-frame validation, and send-after-close compared against `ws`, ready state included on both the throwing and non-throwing paths | done   |
| `tests/conformance/stream.conformance.test.ts`                                                   | Duplex adapter behavior compared against `ws`                                                                                                    | done   |
| `tests/conformance/close.conformance.test.ts`                                                    | `close(code, reason)` argument handling compared against `ws`                                                                                    | done   |
| `tests/compat/socket/refusal-codes.test.ts`, `tests/compat/socket/refusal-payload-codes.test.ts` | The `WS_ERR_*` code, constructor, message, and close code of a refused frame, over real frames                                                   | done   |
| `tests/compat/client/client-request-hooks.test.ts`                                               | `finishRequest` per hop and `generateMask` proven by the bytes on the wire                                                                       | done   |
| `tests/binding/socket-close-race.test.ts`                                                        | A message staged in the same engine read as a peer close still reaches the application                                                           | done   |
| `tests/tooling/oxlint-plugin.test.ts`                                                            | Anti-OOP, enum, and emoji lint rules                                                                                                             | done   |
| `tests/types/**`                                                                                 | Compile-time public surface, every event-map entry, state records                                                                                | done   |
| `tests/declarations/**`                                                                          | Built declarations through the package `exports` map                                                                                             | done   |
| `tests/conformance/**`                                                                           | The same scenario run against `ws` and ventijs, comparing observable behavior                                                                    | done   |
| `bench/**`                                                                                       | Measured echo throughput against `ws` on the same host, with provenance                                                                          | done   |
| `tests/autobahn/**`                                                                              | RFC 6455 conformance through the digest-pinned fuzzing client                                                                                    | done   |
| `tests/autobahn/{shard-plan,shard-weights,diff-gate,run-options}.test.ts`                        | The shard partition, the weight table's self-check, the skip decision, and the flag parser                                                       | done   |
| `src/engine-tests/socket/connections_test.zig`                                                   | The payload boundary with two live connections, which the Autobahn suite cannot reproduce                                                        | done   |
