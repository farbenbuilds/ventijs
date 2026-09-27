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
| `error` with no listeners          | `emit("error")` throws the error; policy lives with the factories                                                              | `src/compat/{events/emitter,socket/socket,server/server}.ts` | done   | `tests/compat/events/emitter.test.ts`  |
| `once` and prepend variants        | `once`, `prependListener`, `prependOnceListener`                                                                               | `src/compat/events/emitter.ts`                               | done   | `tests/compat/events/emitter.test.ts`  |
| Emitter introspection and teardown | `emit`, `removeAllListeners`, `listeners`, `rawListeners`, `eventNames`, `listenerCount`, `getMaxListeners`, `setMaxListeners` | `src/compat/{events/emitter,events/registry}.ts`             | done   | `tests/compat/events/emitter.test.ts`  |

## Socket API (server-side connection)

| Surface                   | Contract                                                                                  | Owner                                                                                   | Status   | Evidence                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Observable properties     | `binaryType`, `bufferedAmount`, `extensions`, `isPaused`, `protocol`, `readyState`, `url` | `src/compat/socket/socket.ts`, `src/binding/socket.ts`, `src/engine/socket/socket.zig`  | partial  | `tests/compat/socket/socket.test.ts`                                      |
| Ready-state constants     | `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` on the constructor and the instance                | `src/compat/{constructors,ready-state}.ts`                                              | done     | `tests/compat/socket/socket.test.ts`                                      |
| Send and frame methods    | `send(data, options?, cb?)`, `ping`, `pong`, `close`, `terminate`, `pause`, `resume`      | `src/compat/socket/{send,lifecycle}.ts`, `src/binding/socket.ts`                        | partial  | `tests/compat/socket/socket.test.ts`, `tests/binding/socket-echo.test.ts` |
| Node events               | `open`, `message`, `close`, `error`, `ping`, `pong`                                       | `src/compat/socket/socket.ts`, `src/compat/events/dom-events.ts`, `src/types/socket.ts` | partial  | `tests/compat/socket/socket.test.ts`, `tests/binding/socket-echo.test.ts` |
| Client-only socket events | `upgrade`, `redirect`, `unexpected-response`                                              | deferred (client scope, ADR)                                                            | deferred | -                                                                         |
| DOM handlers              | `onopen`/`onerror`/`onclose`/`onmessage`, `addEventListener`, `removeEventListener`       | `src/compat/events/{dom-listeners,dom-events}.ts`                                       | done     | `tests/compat/events/dom-listeners.test.ts`                               |
| Close reason handling     | `close(code, reason)` mirrors `ws`: string, `Uint8Array`, or absent reason                | `src/compat/socket/close-reason.ts`                                                     | partial  | `tests/conformance/close.conformance.test.ts`                             |
| Pause gating              | `pause()` stops event emission until `resume()`                                           | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                        | partial  | `tests/compat/socket/socket.test.ts`                                      |

### Where messages flow today

The engine now carries a full RFC 6455 message round trip. `src/engine/server/connections.zig`
registers a `message` callback, the parsed payload is copied into the server's
inbound ring, and `src/engine/ffi/socket_pump.zig` moves staged outbound payloads
onto the wire through the engine's cluster inbox. `tests/binding/socket-echo.test.ts`
proves a text round trip, a binary round trip with the opcode preserved, a burst
inside the inbound budget, and the drop accounting beyond it.
`tests/autobahn/target.ts` is a reference echo over the same path, and
`pnpm bench` measures it against `ws`.

What is still missing is not the protocol but the two transports that reach it:

- The `ws`-shaped facade's HTTP upgrade path adopts a raw Node `Duplex` and does
  no framing, so a socket built by `WebSocketServer` has `attachment === null`
  and reports `ERR_INVALID_STATE` on `send`. The native engine is a separate
  listener with its own RFC 6455 implementation; adopting a Node stream into it
  is the unlanded step.
- Client construction still throws `ERR_INVALID_STATE`, so the whole documented
  client half is unreachable and the `ws` client drives every harness.

Because of that, the remaining `partial` rows split as follows. `send`, `pause`,
and `resume` work on a natively attached socket and fire their callbacks when the
payload is staged rather than when the engine has written it; `close` stages a
close frame that cannot cross the engine's topic publisher, so a peer-initiated
close works and an application-initiated one does not. `ping` and `pong` cannot
cross that publisher either, because it maps a message onto a text or binary
opcode and nothing else. `message` events fire on the engine path and not on the
upgrade path. `terminate()` latches the facade and destroys an upgraded Node
stream. `url`, `protocol`, and `extensions` keep their server-side defaults, and
the server's `perMessageDeflate` option is normalized but never negotiated, so a
client offering the extension still connects uncompressed.

## Engine capacity limits

These are properties of the pinned engine build, not of the facade, and no
JavaScript option can raise them. Each row names the constant that governs it.
The constants live in `src/engine/server/capacities.zig` and are re-exported
from `options.zig`, which owns their validation.

| Limit                  | Value                                  | Governed by                                            | Observable as                                                                                |
| ---------------------- | -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Inbound message size   | 32 KiB                                 | `message_capacity`, `src/engine/server/capacities.zig` | Engine closes with 1009 "Message too large"; `maxPayload` cannot lift it                     |
| Outbound frame size    | 32 KiB                                 | `max_frame_bytes`, same                                | `send` reports `ERR_MAX_PAYLOAD`                                                             |
| Inbound burst          | 64 messages before the consumer drains | `inbound_slots`, `src/engine/server/instance.zig`      | `serverDroppedMessages` counts the loss; `tests/binding/socket-echo.test.ts` pins both sides |
| Connections per server | 128                                    | `connection_capacity`, same                            | A connection past the cap is terminated on open                                              |

`ws` defaults `maxPayload` to 100 MiB and vents 500 MiB frames in its own speed
harness, so the message-size rows are a missing capability rather than a slower
one. `pnpm bench` refuses a payload above the ceiling instead of comparing
absent against present, and `tests/autobahn/` reports the 128 blocked cases as
`skipped-capacity` rather than folding them into a pass or a failure.

## RFC 6455 conformance

The first full Autobahn run, in `autobahn.yml` on commit `47bfc68`, produced 517
cases: 128 skipped over capacity, **160 of 389 evaluated cases passed**, and 229
failed. The failures are committed to `tests/autobahn/baseline.json` with a
reason per group, and the gate fails on any failure outside that list, so it is a
regression gate rather than an exclusion.

| Group | Cases | Gap                                                            |
| ----- | ----- | -------------------------------------------------------------- |
| 13    | 77    | `permessage-deflate` is never negotiated                       |
| 12    | 55    | `permessage-deflate` is never negotiated                       |
| 6     | 70    | UTF-8 handling across the incremental decoder                  |
| 9     | 12    | Frame and payload limits are not enforced as the suite expects |
| 5     | 8     | Fragmented messages are not reassembled                        |
| 1     | 6     | Invalid or partial UTF-8 is not rejected with 1007             |
| 7     | 1     | A close-handshake edge is not conformant                       |

UTF-8 validation, fragmentation, and deflate negotiation are therefore the three
largest protocol gaps, and they account for 210 of the 229. They are engine-side
work in µWebZockets and the engine's own route, not facade work.

## WebSocketServer

| Surface                         | Contract                                                                                                                                                                                                                 | Owner                                                | Status  | Evidence                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| Constructor and listen callback | `new WebSocketServer(options?, callback?)`                                                                                                                                                                               | `src/compat/server/server.ts`                        | done    | `tests/compat/server/server.test.ts`                                                                    |
| Options                         | `host`, `port`, `backlog`, `server`, `noServer`, `path`, `clientTracking`, `verifyClient`, `handleProtocols`, `perMessageDeflate`, `maxPayload`, `skipUTF8Validation`, `allowSynchronousEvents`, `autoPong`, `WebSocket` | `src/compat/options/{shared,server}.ts`              | partial | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts`           |
| Observable properties           | `options`, `path`, `clients`                                                                                                                                                                                             | `src/compat/server/server.ts`, `src/types/server.ts` | done    | `tests/compat/server/server.test.ts`                                                                    |
| Methods                         | `address()`, `close(cb?)`, `handleUpgrade()`, `shouldHandle()`                                                                                                                                                           | `src/compat/server/{server,close,upgrade}.ts`        | done    | `tests/compat/server/{server,upgrade}.test.ts`                                                          |
| Events                          | `connection`, `error`, `headers`, `close`, `listening`, `wsClientError`                                                                                                                                                  | `src/compat/server/{server,listeners,upgrade}.ts`    | done    | `tests/compat/server/{server,upgrade}.test.ts`                                                          |
| HTTP server integration         | `noServer` routing, `server` option, `upgrade` wiring with the Node `http.Server`                                                                                                                                        | `src/compat/server/{upgrade,listeners}.ts`           | done    | `tests/compat/server/upgrade.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                  |
| Handshake policy                | `verifyClient` sync/async, `handleProtocols`, origin/path checks                                                                                                                                                         | `src/compat/server/{upgrade,handshake}.ts`           | done    | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts` |
| Rejections                      | `wsClientError` for handshake failures, destroy semantics                                                                                                                                                                | `src/compat/server/{handshake,upgrade}.ts`           | done    | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts` |

## Stream and client

| Surface                 | Contract                                                                                      | Owner                                | Status   | Evidence                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `createWebSocketStream` | Duplex stream over an open socket                                                             | `src/compat/stream.ts`               | done     | `tests/conformance/stream.conformance.test.ts`, `tests/compat/stream.test.ts`                 |
| Client construction     | `new WebSocket(address, protocols?, options?)`, redirects, `unexpected-response`              | `src/compat/socket/socket.ts` throws | deferred | -                                                                                             |
| Client options          | `followRedirects`, `maxRedirects`, `origin`, `headers`, `agent`, TLS options, `finishRequest` | `src/compat/options/client.ts`       | partial  | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts` |

## Boundary and lifetime invariants

| Invariant                  | Contract                                                                                            | Owner                                                                                    | Status  | Evidence                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Retained inbound payloads  | Frames are copied into Node-owned buffers before handlers run                                       | `src/binding/socket.ts`, `src/engine/ffi/socket_pump.zig`                                | done    | `tests/binding/socket-echo.test.ts`                                               |
| Borrowed outbound buffers  | Buffers live only for the native call, then land in the bounded queue                               | `src/binding/socket.ts`, `src/engine/socket/{payload,socket}.zig`                        | partial | `tests/binding/socket.test.ts`                                                    |
| Generation-checked handles | Stale handles produce typed errors, never crashes or use-after-free                                 | `src/binding/{handle,server,socket}.ts`, `src/engine/socket/handles.zig`                 | partial | `tests/binding/server-lifecycle.test.ts`, `tests/binding/socket-boundary.test.ts` |
| Exactly-once close         | Terminal state is latched before `close` dispatch                                                   | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                         | partial | `tests/binding/socket-boundary.test.ts`, `tests/compat/socket/socket.test.ts`     |
| Backpressure               | `bufferedAmount` growth plus send callbacks, bounded queues; `send` returns no value, matching `ws` | `src/protocol/backpressure.ts`, `src/binding/socket.ts`, `src/engine/socket/payload.zig` | partial | `tests/binding/socket.test.ts`, `tests/compat/socket/socket.test.ts`              |
| Close code mapping         | `maxPayload` 1009, protocol errors 1002, policy rejections 1008                                     | `src/protocol/close-codes.ts`, `src/engine/socket/{status,socket}.zig`                   | partial | `tests/protocol/close-codes.test.ts`                                              |
| Per-message deflate        | Option normalization in TS, codec in the engine                                                     | `src/compat/options/{shared,server,client}.ts`, `src/engine/socket/socket.zig`           | partial | `tests/compat/options/normalization.test.ts`                                      |

## Error shape policy

ventijs throws `Error` instances that keep the `ws` constructor (`TypeError`,
`RangeError`, `SyntaxError`) and message text wherever `ws` defines one, and
adds a stable `ERR_*` code from `src/types/errors.ts` to every error. `ws` uses
`WS_ERR_*` codes internally and leaves many thrown errors uncoded. This
additive divergence follows the repository rule that errors carry a stable
string code; the compat factories must pin the class, message, and code of
every thrown error with tests as they land. The facade pins `ERR_BACKPRESSURE`
for a full staging ring, `ERR_SOCKET_NOT_OPEN` for sends before `open`, the
close-code and close-reason codes for `close()`, and `ERR_PROTOCOL` for
`wsClientError`; `tests/compat/socket/socket.test.ts`, `tests/compat/server/upgrade-policy.test.ts` assert them.

`close(code, reason)` matches `ws` for every argument shape except one.
`src/compat/socket/close-reason.ts` refuses a reason that is neither a string
nor a `Uint8Array` once it carries data, which is the fix for the uninitialized
memory disclosure advisory GHSA-58qx-3vcg-4xpx: a differently typed array
reports a smaller element count than its `byteLength`, so accepting one would
size a close frame from bytes that are never written. The one divergence is
`reason === null`, which `ws` rejects with a V8-internal `TypeError` from reading
`.length` off it and ventijs treats as an absent reason.
`tests/conformance/close.conformance.test.ts` pins both against `ws`.

The handshake is hardened beyond `ws`: a `handleProtocols` result that is not a
token is refused instead of echoed into a response header, and control
characters in `verifyClient` headers or status codes are dropped before the
rejection is written. `ws` forwards those values verbatim.
`tests/compat/server/upgrade*.test.ts` cover both.

## Verification surface

| Suite                                                                                            | Purpose                                                                       | Status  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------- |
| `tests/binding/addon.test.ts`                                                                    | Native build, addon load, engine version round-trip                           | done    |
| `tests/binding/**`                                                                               | Lifecycle, connection slab, and socket operation boundaries                   | done    |
| `tests/binding/socket-echo.test.ts`                                                              | End-to-end text, binary, burst, and inbound drop accounting over the engine   | done    |
| `tests/compat/events/registry.test.ts`                                                           | Listener registry semantics                                                   | done    |
| `tests/protocol/**`                                                                              | Close code, framing, and backpressure helpers                                 | done    |
| `tests/compat/**`                                                                                | Facade units, option normalization, and coded error factories                 | done    |
| `tests/compat/events/emitter.test.ts`                                                            | Listener surface parity with `EventEmitter`, `this` binding, unhandled errors | done    |
| `tests/compat/events/dom-listeners.test.ts`                                                      | DOM listeners, attributes, and event object shapes                            | done    |
| `tests/compat/{socket/socket,server/server,server/upgrade,server/upgrade-policy,stream}.test.ts` | Facade lifecycle and HTTP upgrade policy                                      | done    |
| `tests/conformance/upgrade.conformance.test.ts`                                                  | Handshake responses compared byte-for-byte against `ws`                       | done    |
| `tests/conformance/stream.conformance.test.ts`                                                   | Duplex adapter behavior compared against `ws`                                 | done    |
| `tests/conformance/close.conformance.test.ts`                                                    | `close(code, reason)` argument handling compared against `ws`                 | done    |
| `tests/tooling/oxlint-plugin.test.ts`                                                            | Anti-OOP, enum, and emoji lint rules                                          | done    |
| `tests/types/**`                                                                                 | Compile-time public surface, every event-map entry, state records             | done    |
| `tests/declarations/**`                                                                          | Built declarations through the package `exports` map                          | done    |
| `tests/conformance/**`                                                                           | The same scenario run against `ws` and ventijs, comparing observable behavior | partial |
| `bench/**`                                                                                       | Measured echo throughput against `ws` on the same host, with provenance       | done    |
| `tests/autobahn/**`                                                                              | RFC 6455 conformance through the digest-pinned fuzzing client                 | done    |
