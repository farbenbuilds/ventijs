# ws Compatibility Matrix

ventiws targets 1:1 observable behavior and types with `ws` plus `@types/ws`
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
of ventiws.

## Type surface and packaging

| Surface                      | Contract                                                                              | Owner                                             | Status | Evidence                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Named type exports           | Every `@types/ws` ESM named export, plus `WebSocketEventMap` as a documented superset | `src/types/ws.d.ts`, `src/index.ts`               | done   | `tests/types/consumer.ts`                                              |
| `Server` type                | `export { type Server }` in upstream's ESM entry                                      | `src/types/ws.d.ts`, `src/index.ts`               | done   | `tests/types/consumer.ts`                                              |
| Type-only default            | `import type WebSocket from "ventiws"` mirrors `ws`                                   | `src/index.ts`                                    | done   | `tests/types/consumer.ts`                                              |
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

| Surface                   | Contract                                                                                                           | Owner                                                                                                        | Status | Evidence                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observable properties     | `binaryType`, `bufferedAmount`, `extensions`, `isPaused`, `protocol`, `readyState`, `url`                          | `src/compat/socket/socket.ts`, `src/binding/socket.ts`, `src/engine/socket/socket.zig`                       | done   | `tests/conformance/binary-type*.conformance.test.ts`, `tests/compat/socket/socket.test.ts`                                                                                                                 |
| Ready-state constants     | `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` on the constructor and the instance                                         | `src/compat/{constructors,ready-state}.ts`                                                                   | done   | `tests/compat/socket/socket.test.ts`                                                                                                                                                                       |
| Send and frame methods    | `send(data, options?, cb?)`, `ping`, `pong`, `close`, `terminate`, `pause`, `resume`                               | `src/compat/socket/{send,send-blob,codec-send,control,lifecycle}.ts`, `src/binding/{socket,codec-encode}.ts` | done   | `tests/conformance/send-options.conformance.test.ts`, `tests/conformance/send-payload-options.conformance.test.ts`, `tests/conformance/send-fin.conformance.test.ts`, `tests/compat/socket/socket.test.ts` |
| Node events               | `open`, `message`, `close`, `error`, `ping`, `pong`                                                                | `src/compat/socket/socket.ts`, `src/compat/events/dom-events.ts`, `src/types/socket.ts`                      | done   | `tests/compat/socket/codec-upgrade*.test.ts`, `tests/compat/socket/server-options-acting.test.ts`                                                                                                          |
| Client-only socket events | `upgrade`, `redirect`, `unexpected-response`, all carrying `ws`'s `ClientRequest` and `IncomingMessage`            | `src/compat/client/{dial,open,redirect,unexpected}.ts`                                                       | done   | `tests/compat/client/client-upgrade-event.test.ts`, `tests/compat/client/client-redirect-events.test.ts`, `tests/compat/client/client-refusal.test.ts`                                                     |
| DOM handlers              | `onopen`/`onerror`/`onclose`/`onmessage`, `addEventListener`, `removeEventListener`                                | `src/compat/events/{dom-listeners,dom-events}.ts`                                                            | done   | `tests/compat/events/dom-listeners.test.ts`                                                                                                                                                                |
| Close reason handling     | `close(code, reason)` mirrors `ws`: string, `Uint8Array`, or absent reason, measured before the type is dispatched | `src/compat/socket/close-reason.ts`                                                                          | done   | `tests/conformance/close.conformance.test.ts`                                                                                                                                                              |
| Pause gating              | `pause()` stops event emission until `resume()`                                                                    | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                                             | done   | `tests/compat/socket/socket.test.ts`                                                                                                                                                                       |

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
harness, so the message-size rows bound the engine route only. The codec route,
which is the one every public surface reaches, enforces a per-connection
`maxPayload` up to 100 MiB, growing into it on demand rather than allocating it at
open: a server holding the `ws` default for 128 connections would need 12.5 GiB,
and a peer that never sends a message must not cost anything.

Measured, a single ventiws server against a single client over a loopback socket:

| Payload                    | `ws`       | ventiws     |
| -------------------------- | ---------- | ----------- |
| 1 MiB text message, echoed | 1048576 B  | 1048576 B   |
| 100 MiB, the `ws` default  | not tested | 104857600 B |
| 300 concurrent connections | 300 opened | 300 opened  |

So the public ceiling is `maxPayload` and it already matches `ws`; the 64 KiB row
above is a property of the engine's startup slab and of nothing a caller can
reach. Raising it to `ws`'s default would cost 12.8 GiB per server at 128
connections, so it is a memory decision and not a parity gap. The two routes report
their own ceilings: `engineLimits().messageBytes` for the engine, and the codec
reads the per-connection `maxPayload` it was given.

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

Neither of these is a ventiws gap; both are the pinned `uWebZockets` build's
behaviour, and declining is the answer the RFC allows.

| Behaviour                                                    | Why it is not a gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFC 7692 context takeover is declined                        | The engine has none either. `compress_message` is a one-shot `libdeflate_deflate_compress` over a whole buffer with no retained history (`zig-pkg/uWebZockets-*/src/ws/deflate.zig:104`), and the 9-to-14-bit window path calls `deflateReset` per message (`zig-pkg/uWebZockets-*/src/ws/deflate.zig:231`), which discards the window. The engine answers `server_no_context_takeover; client_no_context_takeover` unconditionally in its own handshake (`zig-pkg/uWebZockets-*/src/ws/handshake.zig:117`). Declining is legal under RFC 7692 section 7.1.1.1 and costs compression ratio, not correctness |
| A compressed message sent in fragments goes out uncompressed | The engine has no fragmented-send API, so it cannot produce one either. RFC 7692 needs a sync flush at each fragment boundary, which one-shot libdeflate cannot emit, so the codec declines at `may_compress` (`src/engine/codec/rsv1.zig:36`, reached from `src/engine/codec/deflate.zig:40`) and at `mayCompress` (`src/compat/socket/codec-send.ts:73`). The receive side does read one, so a `ws` peer interoperates in both directions                                                                                                                                                                 |

Declining takeover even when a peer offers it is what guarantees every message is
independently inflatable.

`finishRequest` and `generateMask` are implemented and pinned by
`tests/compat/client/client-request-hooks.test.ts`: `finishRequest` runs on the first
dial and on every redirect hop with the caller owning `request.end()`, and
`generateMask` supplies the key the encoder puts on the wire, from four bytes that
live on the socket state so the per-frame call allocates nothing.

## What is still outstanding

Nothing in the tables above is `todo` or `deferred`. The rows that were short of evidence
when this branch started now have it, and the ones that were short of `ws` behaviour say
so in their note:

| Surface                           | Status | What remains                                                                                                                                                      | Where                                                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `wss:` to `ws:` redirect          | done   | ventiws refuses the hop and never contacts the destination; `ws` follows it after stripping the credentials. Named in the divergence list at the end of this file | `src/compat/client/redirect.ts:68`, `tests/compat/client/client-redirect-downgrade.test.ts` |
| `url` on a server-accepted socket | done   | ventiws reports `""` where `ws` reports `undefined`, and `ws` contradicts its own `@types/ws`, which declares `readonly url: string`                              | `src/compat/socket/state.ts:40`, `tests/compat/socket/server-url.test.ts`                   |
| `server_max_window_bits` below 15 | done   | The offer is declined rather than answered; `ws` answers it and then compresses at 15 regardless                                                                  | `src/compat/extensions/offer-window.ts`, `tests/compat/extensions/deflate-window.test.ts`   |
| `Too many buffered chunks`        | done   | The `maxBufferedChunks` refusal reports the `maxFragments` message, because the refusal table has one entry for the two conditions                                | `src/compat/socket/refusal-table.ts:72`                                                     |

Each is `done`: the behaviour is implemented and pinned, and what remains is a
difference from `ws` that is deliberate rather than a surface to build.

## RFC 6455 conformance

The gate is a regression gate over the cases `tests/autobahn/baseline.json` lists.
A failure outside the list fails the run, and a listed case that starts passing is
reported and fails the run until the list is shortened. Drift is only ever reported
for a listed id, so the gate constrains the listed cases and nothing else: a case
that was never listed and starts passing produces no violation, and no baseline
needs regenerating for it. A listed case that a protocol fix moves does need a
regenerated baseline, which takes one recorded run of the digest-pinned suite on a
Docker-capable host.

**Current state, from `.github/workflows/autobahn.yml` run 36735219994, recorded in
`tests/autobahn/baseline.json`:** the full 517-case selection ran because the
Autobahn target now negotiates `permessage-deflate`; 414 of 422 evaluated cases
passed, 7 non-strict, 8 failed, and 95 are capacity-blocked. The eight failures
are the group-9 rate cases below.

| Group | Failing | What the report says                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9     | 8       | Rate rather than conformance: each case sends 1000 messages as fast as the peer will take them, and the suite marks the case failed when the agent cannot sustain the rate. The boundary is the payload size, not the message cap, because group 1's 65536-byte cases pass. The inbound ring holds 64 messages and the Node main thread drains it, so a burst outruns the consumer |

Groups 12 and 13 left the baseline in the same run: all 132 previously listed
deflate cases passed once the target negotiated the extension, and the two rows
that still fail (`12.4.9`, `12.4.14`) are capacity-blocked rather than listed,
because group 12's dataset 4 slices a decoded string by code points and its
65536-code-point row encodes to up to 65563 UTF-8 bytes. The wiring is
`RawConfig.permessage_deflate` in `src/engine/server/options.zig:46` and
`.compression = .permessage_deflate` in
`src/engine/server/connections.zig:18`.

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

| Surface                         | Contract                                                                                                                                                                                                                                                      | Owner                                                                                 | Status | Evidence                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constructor and listen callback | `new WebSocketServer(options?, callback?)`                                                                                                                                                                                                                    | `src/compat/server/server.ts`                                                         | done   | `tests/compat/server/server.test.ts`                                                                                                                                                                                                                                                     |
| Options                         | `host`, `port`, `backlog`, `server`, `noServer`, `path`, `clientTracking`, `verifyClient`, `handleProtocols`, `perMessageDeflate`, `maxPayload`, `maxFragments`, `skipUTF8Validation`, `allowSynchronousEvents`, `autoPong`, `maxBufferedChunks`, `WebSocket` | `src/compat/options/{shared,bounded,server}.ts`, `src/compat/socket/codec-inbound.ts` | done   | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts`, `tests/compat/server/options-parity.test.ts`, `tests/compat/socket/max-payload.test.ts`, `tests/compat/socket/server-options-acting.test.ts`, `tests/compat/socket/inbound-queue.test.ts` |
| Observable properties           | `options`, `path`, `clients`                                                                                                                                                                                                                                  | `src/compat/server/server.ts`, `src/types/server.ts`                                  | done   | `tests/compat/server/server.test.ts`, `tests/compat/server/options-parity.test.ts`, `tests/compat/socket/client-tracking.test.ts`                                                                                                                                                        |
| Methods                         | `address()`, `close(cb?)`, `handleUpgrade()`, `shouldHandle()`                                                                                                                                                                                                | `src/compat/server/{server,close,upgrade}.ts`                                         | done   | `tests/compat/server/{server,upgrade}.test.ts`, `tests/compat/server/routing-parity.test.ts`                                                                                                                                                                                             |
| Events                          | `connection`, `error`, `headers`, `close`, `listening`, `wsClientError`                                                                                                                                                                                       | `src/compat/server/{server,listeners,upgrade}.ts`                                     | done   | `tests/compat/server/{server,upgrade}.test.ts`                                                                                                                                                                                                                                           |
| HTTP server integration         | `noServer` routing, `server` option, `upgrade` wiring with the Node `http.Server`                                                                                                                                                                             | `src/compat/server/{upgrade,listeners}.ts`                                            | done   | `tests/compat/server/upgrade.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                                                                                   |
| Handshake policy                | `verifyClient` sync/async, `handleProtocols`, origin/path checks                                                                                                                                                                                              | `src/compat/server/{upgrade,handshake}.ts`                                            | done   | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                                                                  |
| Rejections                      | `wsClientError` for handshake failures, destroy semantics                                                                                                                                                                                                     | `src/compat/server/{handshake,upgrade}.ts`                                            | done   | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                                                                                                                                                  |

## Stream and client

| Surface                 | Contract                                                                                                                                                 | Owner                                                                                        | Status | Evidence                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWebSocketStream` | Duplex stream over an open socket; object mode converts a text message and `_final` settles on the close frame rather than the peer's answer             | `src/compat/stream.ts`                                                                       | done   | `tests/conformance/stream.conformance.test.ts`, `tests/compat/stream.test.ts`                                                                                                                                                                                         |
| Client construction     | `new WebSocket(address, protocols?, options?)`, redirects, `unexpected-response`                                                                         | `src/compat/client/**`                                                                       | done   | `tests/compat/client/**`, every case against a real `ws` server                                                                                                                                                                                                       |
| Client options          | `followRedirects`, `maxRedirects`, `origin`, `headers`, `handshakeTimeout`, `closeTimeout`, and the `http.request` and TLS keys `ClientOptions` inherits | `src/compat/options/client.ts`, `src/compat/client/{handshake-headers,transport-options}.ts` | done   | `tests/compat/client/client-{options,redirect}.test.ts`, `tests/compat/client/client-request-headers.test.ts`, `tests/compat/client/client-handshake-timeout.test.ts`, `tests/compat/client/client-tls-options.test.ts`, `tests/compat/options/normalization.test.ts` |

## Boundary and lifetime invariants

| Invariant                  | Contract                                                                                                                                                                                                     | Owner                                                                                                     | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retained inbound payloads  | Frames are copied into Node-owned buffers before handlers run                                                                                                                                                | `src/binding/socket.ts`, `src/engine/ffi/socket_pump.zig`                                                 | done       | `tests/binding/socket-echo.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Borrowed outbound buffers  | Buffers live only for the native call, then land in the bounded queue                                                                                                                                        | `src/binding/socket.ts`, `src/engine/socket/{payload,socket}.zig`                                         | done       | `tests/binding/socket.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Generation-checked handles | Stale handles produce typed errors, never crashes or use-after-free                                                                                                                                          | `src/binding/{handle,server,socket}.ts`, `src/engine/socket/handles.zig`                                  | done       | `tests/binding/server-lifecycle.test.ts`, `tests/binding/socket-boundary.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Exactly-once close         | Terminal state is latched before `close` dispatch                                                                                                                                                            | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                                          | done       | `tests/binding/socket-boundary.test.ts`, `tests/compat/socket/socket.test.ts`, `src/engine-tests/socket/socket_test.zig`                                                                                                                                                                                                                                                                                                                                                                                      |
| Inbound ring reclamation   | A connection that closes with messages staged cannot strand the ring for every other connection                                                                                                              | `src/engine/socket/queues.zig`, `src/engine/ffi/socket_inbound.zig`                                       | done       | `src/engine-tests/socket/inbound_purge_test.zig`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Backpressure               | `bufferedAmount` growth plus send callbacks, bounded queues; `send` returns no value, matching `ws`; inbound and outbound loss counted separately                                                            | `src/binding/{socket,inbound,server}.ts`, `src/engine/socket/payload.zig`, `src/compat/socket/payload.ts` | done       | `tests/binding/socket.test.ts`, `tests/compat/socket/send-reporting.test.ts`, `tests/compat/client/soak-backpressure.test.ts`                                                                                                                                                                                                                                                                                                                                                                                 |
| Bounded close handshake    | A close that a peer never answers is torn down at `closeTimeout` and reports 1006, rather than holding a transport and a codec slot indefinitely                                                             | `src/compat/socket/codec-close.ts`                                                                        | done       | `tests/compat/client/client-close-timeout.test.ts`, `tests/compat/socket/codec-upgrade-close-timeout.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Engine-route close         | An app-initiated close on an adopted engine socket reports `ERR_POLICY_VIOLATION` and leaves the socket OPEN, rather than claiming a close frame the engine cannot send until the engine-thread drain exists | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket_ops.zig`                                      | divergence | `tests/binding/socket-close-unsupported.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Redirect hygiene           | Credentials are carried across a redirect within one origin and dropped across a change of authority, and a `wss:` to `ws:` downgrade is refused                                                             | `src/compat/client/redirect.ts`                                                                           | done       | `tests/compat/client/client-redirect-credentials.test.ts`, `tests/compat/client/client-redirect-limits.test.ts`, `tests/compat/client/client-redirect-downgrade.test.ts`                                                                                                                                                                                                                                                                                                                                      |
| Close code mapping         | `maxPayload` 1009, protocol errors 1002, policy rejections 1008, too many fragments 1008                                                                                                                     | `src/protocol/close-codes.ts` (outgoing validation), `src/engine/codec/events.zig` (the mapping)          | done       | `tests/protocol/close-codes.test.ts`, `tests/compat/socket/fragment-bound.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Per-message deflate        | RFC 7692 on both routes: option normalization, header negotiation, compression, and inflate                                                                                                                  | `src/compat/extensions/{grammar,params,deflate,offer}.ts`, `src/engine/codec/{deflate,inflate,rsv1}.zig`  | done       | `tests/compat/extensions/{grammar,deflate,deflate-client}.test.ts`, `tests/compat/socket/permessage-deflate.test.ts`, `tests/compat/socket/deflate-frames.test.ts`, `src/engine-tests/codec/deflate_test.zig`, `tests/compat/extensions/deflate-window.test.ts`. A `server_max_window_bits` below 15 is declined, where `ws` accepts it and then compresses at 15 regardless; a `client_max_window_bits` at any legal value is accepted, per RFC 7692 section 7.1.1.2; no context takeover in both directions |

## Error shape policy

ventiws throws `Error` instances that keep the `ws` constructor (`TypeError`,
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

Both halves of `WS_ERR_TOO_MANY_BUFFERED_PARTS` are reachable. In `ws` the code covers
two conditions, `maxFragments` and `maxBufferedChunks`, with the same 1008 and the same
`RangeError` and a different message each; ventiws has one refusal entry for the two, so
the `maxBufferedChunks` path reports `Too many message fragments` where `ws` reports
`Too many buffered chunks` (`node_modules/ws/lib/receiver.js:106`). The code, the close
code, and the constructor are `ws`'s on both paths, and
`tests/compat/socket/inbound-queue.test.ts` covers the second of them.

`close(code, reason)` matches `ws` for every argument shape. Two behaviours
differ and both are deliberate:

- A close `ws` refuses still closes. `ws` latches `CLOSING` before it validates,
  so a bad code or a bad reason leaves the socket closing. ventiws validated
  first, which left it `OPEN` and let a caller retry a close `ws` had already
  accepted as a decision. `tests/compat/socket/close.test.ts` pins the ready
  state on both the throwing and the non-throwing path, because an error-only
  comparison cannot see this. That half is measured against `ws` only by reading
  it; this row is the one place in the tables where the `ws` side rests on the
  source rather than on a run.
- `reason === null` is treated as an absent reason. `ws` rejects it with a
  V8-internal `TypeError` from reading `.length` off it.

`src/compat/socket/close-reason.ts` refuses a reason that is neither a string nor a
`Uint8Array` once it carries data: a differently typed array reports a smaller
element count than its `byteLength`, so accepting one would size a close frame from
bytes that are never written (GHSA-58qx-3vcg-4xpx). `ws` 8.21.3 refuses the
argument at `sender.js:207`, so this describes the pre-8.20.1 code path.
`tests/conformance/close.conformance.test.ts` pins the argument handling and
`tests/protocol/close-codes.test.ts` the predicates.

The opening handshake is built the way `ws` builds it, and three of its orderings are
observable on the wire. The library's own upgrade headers go _over_ the caller's
(`src/compat/client/handshake-headers.ts:38`), so a caller merging headers from a config
object cannot set `Connection: keep-alive` and produce a request that is not an upgrade.
A caller's `Authorization` wins over URL credentials, which are applied only when the
caller set none, so a bearer token is not silently downgraded to basic auth. And
`origin` is gated on truthiness, as `ws` gates it, so `origin: ''` sends no header rather
than `Origin:` with an empty value. `handshakeTimeout` is gated the same way, so `0` is no
deadline rather than a timer that refuses the handshake on the next tick. All four are read
off a hand-answering raw peer by `tests/compat/client/client-request-headers.test.ts` and
`tests/compat/client/client-handshake-timeout.test.ts`.

`send`'s `mask` option is honoured on a client, so `mask: false` puts an unmasked frame on
the wire and the peer answers `WS_ERR_EXPECTED_MASK` and closes, exactly as `ws` does; the
ABI carries the choice as `maskFrame` (`src/binding/native.ts:118`). A server never masks,
which was already the documented position and remains deliberate: a masked server frame is
a protocol error a peer is entitled to close on
(`src/compat/socket/codec-outbound.ts:32`). `compress: false` leaves RSV1 clear, a `Blob`
is sent as its bytes, and both orders are pinned by
`tests/conformance/send-payload-options.conformance.test.ts`.

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

Four more divergences worth naming, all measured against `ws`. The first two are a
superset rather than a mismatch:

- `ws` types `close` as `(code?: number, reason?: string | Buffer)` and
  `ping`/`pong` payloads are validated against RFC 6455's 125-byte control cap
  with a thrown `RangeError`, which ventiws now matches. A fractional reserved
  code such as `1005.5` passes both validators and truncates; `ws` then writes
  1005 to the wire while the engine's own close-code validation refuses 1005 and
  reports `ERR_INVALID_CLOSE_CODE`.
- `@types/ws` declares `readonly path: string` on the server but `ws`'s runtime
  never sets it, so `"path" in server` is false there. ventiws exposes it.
  `server.clients` is the mirror image and is now absent when
  `clientTracking` is falsy, exactly as `ws` leaves it, rather than present and
  `undefined`.

The other two are a kept difference, and neither is a gap:

- A `wss:` to `ws:` redirect is refused with `Cannot follow a redirect from wss: to ws:`
  (`src/compat/client/redirect.ts:68`) and the destination is never contacted. `ws` follows
  it: the downgrade is one arm of its credential-stripping condition
  (`websocket.js:846`), so it deletes `authorization`, `cookie` and `auth` and then dials
  the plaintext hop. Both legs run in
  `tests/compat/client/client-redirect-downgrade.test.ts` and the difference is written
  down, because a caller migrating has to be able to see it.
- A server-accepted socket's `url` is `""` where `ws` reports `undefined`, because `ws`
  assigns a URL only in `initAsClient` (`websocket.js:719`) and
  `@types/ws` declares `readonly url: string` anyway. `"url" in socket` is true on both, so
  only the value tells the two apart. Recorded by
  `tests/compat/socket/server-url.test.ts`; the honest type is `string | undefined`, which
  means changing `SocketState.url` and the record's getter.

## Verification surface

| Suite                                                                                            | Purpose                                                                                                                                                        | Status |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `tests/binding/addon.test.ts`                                                                    | Native build, addon load, engine version round-trip                                                                                                            | done   |
| `tests/binding/**`                                                                               | Lifecycle, connection slab, and socket operation boundaries                                                                                                    | done   |
| `tests/binding/socket-echo.test.ts`                                                              | End-to-end text, binary, burst, and inbound drop accounting over the engine                                                                                    | done   |
| `tests/compat/events/registry.test.ts`                                                           | Listener registry semantics                                                                                                                                    | done   |
| `tests/protocol/**`                                                                              | Close code, framing, and backpressure helpers                                                                                                                  | done   |
| `tests/compat/**`                                                                                | Facade units, option normalization, and coded error factories                                                                                                  | done   |
| `tests/compat/events/emitter.test.ts`                                                            | Listener surface parity with `EventEmitter`, `this` binding, unhandled errors                                                                                  | done   |
| `tests/compat/events/dom-listeners.test.ts`                                                      | DOM listeners, attributes, and event object shapes                                                                                                             | done   |
| `tests/compat/{socket/socket,server/server,server/upgrade,server/upgrade-policy,stream}.test.ts` | Facade lifecycle and HTTP upgrade policy                                                                                                                       | done   |
| `tests/compat/socket/codec-upgrade*.test.ts`                                                     | The upgrade route against a real `ws` peer in both directions                                                                                                  | done   |
| `tests/compat/client/**`                                                                         | The client against a real `ws` server, a scripted raw peer, or a self-signed `wss:` peer: messages, frames, lifecycle, refusals, redirects                     | done   |
| `tests/compat/client/soak*.test.ts`                                                              | Repetition, concurrency, and a slow peer, measured for leaks and bounded queues                                                                                | done   |
| `tests/binding/codec*.test.ts`                                                                   | The codec's Node-API surface, including the interop cases that pinned the boundary                                                                             | done   |
| `tests/conformance/upgrade.conformance.test.ts`                                                  | Handshake responses compared byte-for-byte against `ws`                                                                                                        | done   |
| `tests/conformance/{control,send-after-close}.conformance.test.ts`                               | Control-frame validation and send-after-close compared against `ws`; the close latch is pinned in `tests/compat/socket/close.test.ts` rather than against `ws` | done   |
| `tests/conformance/stream.conformance.test.ts`                                                   | Duplex adapter behavior compared against `ws`                                                                                                                  | done   |
| `tests/conformance/close.conformance.test.ts`                                                    | `close(code, reason)` argument handling compared against `ws`                                                                                                  | done   |
| `tests/compat/socket/refusal-codes.test.ts`, `tests/compat/socket/refusal-payload-codes.test.ts` | The `WS_ERR_*` code, constructor, message, and close code of a refused frame, over real frames                                                                 | done   |
| `tests/compat/client/client-request-hooks.test.ts`                                               | `finishRequest` per hop and `generateMask` proven by the bytes on the wire                                                                                     | done   |
| `tests/compat/socket/inbound-queue.test.ts`                                                      | The read queue behind a deferred delivery loses nothing, and the `maxBufferedChunks` bound refuses with `ws`'s code                                            | done   |
| `tests/conformance/send-payload-options.conformance.test.ts`                                     | `compress: false`, `mask: false`, and a `Blob` payload, read off the wire rather than through a round trip                                                     | done   |
| `tests/compat/client/client-{request-headers,handshake-timeout,tls-options}.test.ts`             | The header merge order, the `origin` and `handshakeTimeout` truthiness rules, and the forwarded TLS options                                                    | done   |
| `tests/binding/socket-close-race.test.ts`                                                        | A message staged in the same engine read as a peer close still reaches the application                                                                         | done   |
| `tests/tooling/oxlint-plugin.test.ts`                                                            | Anti-OOP, enum, and emoji lint rules                                                                                                                           | done   |
| `tests/types/**`                                                                                 | Compile-time public surface, every event-map entry, state records                                                                                              | done   |
| `tests/declarations/**`                                                                          | Built declarations through the package `exports` map                                                                                                           | done   |
| `tests/conformance/**`                                                                           | The same scenario run against `ws` and ventiws, comparing observable behavior                                                                                  | done   |
| `bench/**`                                                                                       | Measured echo throughput against `ws` on the same host, with provenance                                                                                        | done   |
| `tests/autobahn/**`                                                                              | RFC 6455 conformance through the digest-pinned fuzzing client                                                                                                  | done   |
| `tests/autobahn/{shard-plan,shard-weights,diff-gate,run-options}.test.ts`                        | The shard partition, the weight table's self-check, the skip decision, and the flag parser                                                                     | done   |
| `src/engine-tests/socket/connections_test.zig`                                                   | The payload boundary with two live connections, which the Autobahn suite cannot reproduce                                                                      | done   |
