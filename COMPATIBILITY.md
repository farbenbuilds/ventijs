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

The engine carries a full RFC 6455 message round trip. `src/engine/server/connections.zig`
registers a `message` callback, the parsed payload is copied into the server's
inbound ring, and `src/engine/ffi/socket_pump.zig` moves staged outbound payloads
onto the wire through the engine's cluster inbox. `tests/binding/socket-echo.test.ts`
proves a text round trip, a binary round trip with the opcode preserved, a burst
inside the inbound budget, and the drop accounting beyond it.
`tests/autobahn/target.ts` is a reference echo over the same path, and
`pnpm bench` measures it against `ws`.

**That route is not reachable from the public surface, and the rows that say
"engine route" mean the test harness, not the product.** No file under
`src/compat/` calls `createServer`, `listenServer`, `pumpSocket`, or
`takeSocketMessage`; the complete set of `src/binding/**` imports in the facade is
five lines, all socket operations. `src/compat/server/server.ts` is a Node
`http.Server` throughout. The only callers of `pumpSocket` are
`tests/binding/echo-support.ts`, `tests/autobahn/target-echo.ts`, and
`bench/echo/native-state.ts`, and the only producers of a `ConnectionHandle` are
two test files. So `send` on a `WebSocketServer`-produced socket stages nothing and
emits `ERR_INVALID_STATE`, and `message` never fires there.

Two gaps follow, and they are architecture rather than effort:

- The facade's HTTP upgrade path adopts a raw Node `Duplex` and does no framing.
  The pinned engine cannot adopt an already-accepted socket: its `WebSocket`
  requires a router `Request`/`Response` pair from its own listener. A working
  route is therefore either a TypeScript receiver over the adopted `Duplex`, which
  duplicates framing that `AGENTS.md` says Zig will own, or a reduction of
  `WebSocketServer` to a `noServer`-shaped shim over `src/binding/server.ts`,
  which changes the transport model of every public server surface. The first is
  shippable and the second is not, and the choice contradicts the architecture
  document either way, so it needs an ADR rather than a patch.
- Client construction throws `ERR_INVALID_STATE`, so the whole documented client
  half is unreachable. `normalizeClientOptions` has no caller in `src/`, and
  `createSocket` discards both `protocols` and `options` outright. A client needs
  a TCP or TLS socket and the same RFC 6455 codec; the engine exposes no client
  entry point at all, so this is facade work or a new engine ABI.

Because of that, the remaining `partial` rows split as follows. `send`, `pause`,
and `resume` work on a natively attached socket and fire their callbacks when the
payload is staged rather than when the engine has written it; `close` stages a
close frame that cannot cross the engine's topic publisher, so a peer-initiated
close works and an application-initiated one does not. `ping` and `pong` cannot
cross that publisher either, because it maps a message onto a text or binary
opcode and nothing else; their argument handling, including the RFC 6455 125-byte
control-payload cap, is implemented and pinned against `ws`.
`message` events fire on the engine path and not on the upgrade path.
`terminate()` latches `CLOSING` before it destroys. `protocol` is now published
before `open` fires, so it is observable from an `open` listener; `url` and
`extensions` keep their defaults, and the server's `perMessageDeflate` option is
normalized but never negotiated, so a client offering the extension still
connects uncompressed.

## Engine capacity limits

These are properties of the pinned engine build, not of the facade, and no
JavaScript option can raise them. Each row names the constant that governs it.
The constants live in `src/engine/server/capacities.zig` and are re-exported
from `options.zig`, which owns their validation.

| Limit                  | Value                                  | Governed by                                            | Observable as                                                                                                                                              |
| ---------------------- | -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound message size   | 32 KiB                                 | `message_capacity`, `src/engine/server/capacities.zig` | Engine closes with 1009 "Message too large"; `maxPayload` cannot lift it                                                                                   |
| Outbound frame size    | 32 KiB                                 | `max_frame_bytes`, same                                | `send` reports `ERR_MAX_PAYLOAD`                                                                                                                           |
| Inbound burst          | 64 messages before the consumer drains | `inbound_slots`, `src/engine/server/instance.zig`      | `serverDroppedMessages` counts the loss, and also counts a message discarded from a paused connection; `tests/binding/socket-echo.test.ts` pins both sides |
| Connections per server | 128                                    | `connection_capacity`, same                            | A connection past the cap is terminated on open                                                                                                            |

`ws` defaults `maxPayload` to 100 MiB and vents 500 MiB frames in its own speed
harness, so the message-size rows are a missing capability rather than a slower
one. Raising `message_capacity` is a one-line change to a `comptime` constant in
`src/engine/server/capacities.zig` and costs `message_capacity x connection_capacity`
of slab per live server; it is not gated on anything except a Docker run, because
it changes the case counts the harness asserts. `pnpm bench` refuses a payload above the ceiling instead of comparing
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

UTF-8 validation, fragmentation, and deflate negotiation account for 210 of the
229, so they are the three largest gaps. **What causes them was re-derived from
the pinned engine and four of the five recorded reasons do not survive.**

The incremental UTF-8 decoder, fragment reassembly, the 1007 rejection, the close
handshake, and the per-message deflate codec are all present and correct in the
pinned `uWebZockets` tree, and the engine's own Autobahn target enables the
extension on the same route ventijs uses:

```zig
// zig-pkg/uWebZockets-1.7.0-.../tests/autobahn/main.zig
_ = try app.ws("/", .{
    .message = echo_message,
    .compression = .permessage_deflate,      // the line ventijs omits
    .max_frame_size = max_message_size,
});
```

against

```zig
// src/engine/server/connections.zig
_ = try app.ws(target.config.path_slice(), .{
    .open = Trampoline.open,
    .message = Trampoline.message,
    .close = Trampoline.close,
    .max_frame_size = ...,
    .max_message_size = ...,
});
```

`WsBehavior.compression` defaults to `.disabled`, so groups 12 and 13 are
UNIMPLEMENTED for want of one struct field, and `WebSocket.send` compresses
automatically once `permessage_deflate` is negotiated, so the outbound hop is not
the obstacle. Groups 1, 5, 6, and 7 are not explained by the recorded reasons at
all, and the baseline was recorded on `47bfc68`, whose `src/engine/` tree is
byte-identical to this one, so the same code produced them.

**None of this can be landed as a protocol change yet, and the reason is
structural rather than a matter of effort.** The gate fails a run whose
`baseline.json` lists a case that now passes, so fixing a protocol gap _must_ be
accompanied by a regenerated baseline, and the baseline can only be regenerated by
the digest-pinned suite. That image is a frozen Python 2.7 / PyPy build, so it
requires Docker, and the case set is only meaningful against that exact digest. A
change to any of these five rows therefore lands red until a host with Docker
records a new baseline, and the recipe for each is below.

| Gap        | What is actually missing                                                                                                                                                                                      | Where                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 12, 13     | `.compression = .permessage_deflate` on the route, plus the option reaching Zig: `NativeServerConfig` in `src/binding/native.ts` and `RawConfig` in `src/engine/server/options.zig` have no compression field | `src/engine/server/connections.zig:41` |
| 9          | `9.7` and `9.8` are absent from `CAPACITY_RULES`, so twelve cases are counted as failures rather than capacity-blocked, or `message_capacity` raised above 64 KiB                                             | `tests/autobahn/expected-cases.ts:77`  |
| 1, 6, 5, 7 | Not established. The recorded reasons are contradicted by the pinned code; a per-case `report.json` is the missing evidence                                                                                   | -                                      |

`docs/compliance.md` records the status vocabulary these rows use.

## WebSocketServer

| Surface                         | Contract                                                                                                                                                                                                                 | Owner                                                | Status  | Evidence                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Constructor and listen callback | `new WebSocketServer(options?, callback?)`                                                                                                                                                                               | `src/compat/server/server.ts`                        | done    | `tests/compat/server/server.test.ts`                                                                                                        |
| Options                         | `host`, `port`, `backlog`, `server`, `noServer`, `path`, `clientTracking`, `verifyClient`, `handleProtocols`, `perMessageDeflate`, `maxPayload`, `skipUTF8Validation`, `allowSynchronousEvents`, `autoPong`, `WebSocket` | `src/compat/options/{shared,server}.ts`              | partial | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts`, `tests/compat/server/options-parity.test.ts` |
| Observable properties           | `options`, `path`, `clients`                                                                                                                                                                                             | `src/compat/server/server.ts`, `src/types/server.ts` | partial | `tests/compat/server/server.test.ts`, `tests/compat/server/options-parity.test.ts`                                                          |
| Methods                         | `address()`, `close(cb?)`, `handleUpgrade()`, `shouldHandle()`                                                                                                                                                           | `src/compat/server/{server,close,upgrade}.ts`        | done    | `tests/compat/server/{server,upgrade}.test.ts`, `tests/compat/server/routing-parity.test.ts`                                                |
| Events                          | `connection`, `error`, `headers`, `close`, `listening`, `wsClientError`                                                                                                                                                  | `src/compat/server/{server,listeners,upgrade}.ts`    | done    | `tests/compat/server/{server,upgrade}.test.ts`                                                                                              |
| HTTP server integration         | `noServer` routing, `server` option, `upgrade` wiring with the Node `http.Server`                                                                                                                                        | `src/compat/server/{upgrade,listeners}.ts`           | done    | `tests/compat/server/upgrade.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                                      |
| Handshake policy                | `verifyClient` sync/async, `handleProtocols`, origin/path checks                                                                                                                                                         | `src/compat/server/{upgrade,handshake}.ts`           | done    | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                     |
| Rejections                      | `wsClientError` for handshake failures, destroy semantics                                                                                                                                                                | `src/compat/server/{handshake,upgrade}.ts`           | done    | `tests/compat/server/{upgrade,upgrade-policy}.test.ts`, `tests/conformance/upgrade.conformance.test.ts`                                     |

## Stream and client

| Surface                 | Contract                                                                                      | Owner                                | Status   | Evidence                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `createWebSocketStream` | Duplex stream over an open socket                                                             | `src/compat/stream.ts`               | partial  | `tests/conformance/stream.conformance.test.ts`, `tests/compat/stream.test.ts`                 |
| Client construction     | `new WebSocket(address, protocols?, options?)`, redirects, `unexpected-response`              | `src/compat/socket/socket.ts` throws | deferred | -                                                                                             |
| Client options          | `followRedirects`, `maxRedirects`, `origin`, `headers`, `agent`, TLS options, `finishRequest` | `src/compat/options/client.ts`       | partial  | `tests/compat/options/normalization.test.ts`, `tests/conformance/options.conformance.test.ts` |

## Boundary and lifetime invariants

| Invariant                  | Contract                                                                                            | Owner                                                                                                  | Status  | Evidence                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Retained inbound payloads  | Frames are copied into Node-owned buffers before handlers run                                       | `src/binding/socket.ts`, `src/engine/ffi/socket_pump.zig`                                              | done    | `tests/binding/socket-echo.test.ts`                                                                                      |
| Borrowed outbound buffers  | Buffers live only for the native call, then land in the bounded queue                               | `src/binding/socket.ts`, `src/engine/socket/{payload,socket}.zig`                                      | done    | `tests/binding/socket.test.ts`                                                                                           |
| Generation-checked handles | Stale handles produce typed errors, never crashes or use-after-free                                 | `src/binding/{handle,server,socket}.ts`, `src/engine/socket/handles.zig`                               | done    | `tests/binding/server-lifecycle.test.ts`, `tests/binding/socket-boundary.test.ts`                                        |
| Exactly-once close         | Terminal state is latched before `close` dispatch                                                   | `src/compat/socket/lifecycle.ts`, `src/engine/socket/socket.zig`                                       | done    | `tests/binding/socket-boundary.test.ts`, `tests/compat/socket/socket.test.ts`, `src/engine-tests/socket/socket_test.zig` |
| Backpressure               | `bufferedAmount` growth plus send callbacks, bounded queues; `send` returns no value, matching `ws` | `src/binding/socket.ts`, `src/engine/socket/payload.zig`                                               | partial | `tests/binding/socket.test.ts`, `tests/compat/socket/socket.test.ts`, `tests/compat/socket/send-reporting.test.ts`       |
| Close code mapping         | `maxPayload` 1009, protocol errors 1002, policy rejections 1008                                     | `src/protocol/close-codes.ts` (outgoing validation), the pinned engine's `ws/socket.zig` (the mapping) | partial | `tests/protocol/close-codes.test.ts`                                                                                     |
| Per-message deflate        | Option normalization in TS, codec in the engine                                                     | `src/compat/options/{shared,server,client}.ts`, `src/engine/socket/socket.zig`                         | partial | `tests/compat/options/normalization.test.ts`                                                                             |

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

`src/compat/socket/close-reason.ts` refuses a reason that is neither a string
nor a `Uint8Array` once it carries data, which is the fix for the uninitialized
memory disclosure advisory GHSA-58qx-3vcg-4xpx: a differently typed array
reports a smaller element count than its `byteLength`, so accepting one would
size a close frame from bytes that are never written. One note on that advisory:
`ws` 8.21.3 refuses the argument at `sender.js:207`, so the framing above describes
the pre-8.20.1 code path rather than a hazard a caller can still reach.
`tests/conformance/close.conformance.test.ts` pins the argument handling and
`tests/protocol/close-codes.test.ts` the predicates.

A send is reported the way `ws` reports it, which is a split rather than one rule.
A send on a socket that is not `OPEN` goes to `sendAfterClose`: the bytes are
accounted, the callback is told, and nothing else happens, because a caller
sending during a close in progress cannot tell a teardown from a fault. A send
that failed on an _open_ socket goes to `emitErrorAndClose`: `CLOSING` is latched,
`error` is emitted once, and the socket then closes. That is the only path that
emits, and it is the only one a caller with no callback has anything to observe.
`tests/conformance/send-after-close.conformance.test.ts` compares the first half
against `ws` and `tests/compat/socket/send-reporting.test.ts` pins both.

`terminate()` latches `CLOSING` before it destroys, so a terminated socket is
observably closing until the transport's `close` event finishes it, and a
`close` or `terminate` while still `CONNECTING` emits `error` with `WebSocket was
closed before the connection was established` before the 1006 `close`, matching
`ws`'s `abortHandshake`. `tests/compat/socket/lifecycle.test.ts` covers both.

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
- The socket's handshake-phase `error` handler is removed once the 101 is written.
  `ws` removes it, and leaving it attached put a second handler on every upgraded
  socket that destroyed without latching.

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

| Suite                                                                                            | Purpose                                                                                                                                          | Status  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `tests/binding/addon.test.ts`                                                                    | Native build, addon load, engine version round-trip                                                                                              | done    |
| `tests/binding/**`                                                                               | Lifecycle, connection slab, and socket operation boundaries                                                                                      | done    |
| `tests/binding/socket-echo.test.ts`                                                              | End-to-end text, binary, burst, and inbound drop accounting over the engine                                                                      | done    |
| `tests/compat/events/registry.test.ts`                                                           | Listener registry semantics                                                                                                                      | done    |
| `tests/protocol/**`                                                                              | Close code, framing, and backpressure helpers                                                                                                    | done    |
| `tests/compat/**`                                                                                | Facade units, option normalization, and coded error factories                                                                                    | done    |
| `tests/compat/events/emitter.test.ts`                                                            | Listener surface parity with `EventEmitter`, `this` binding, unhandled errors                                                                    | done    |
| `tests/compat/events/dom-listeners.test.ts`                                                      | DOM listeners, attributes, and event object shapes                                                                                               | done    |
| `tests/compat/{socket/socket,server/server,server/upgrade,server/upgrade-policy,stream}.test.ts` | Facade lifecycle and HTTP upgrade policy                                                                                                         | done    |
| `tests/conformance/upgrade.conformance.test.ts`                                                  | Handshake responses compared byte-for-byte against `ws`                                                                                          | done    |
| `tests/conformance/{close-latch,control,send-after-close}.conformance.test.ts`                   | Latching, control-frame validation, and send-after-close compared against `ws`, ready state included on both the throwing and non-throwing paths | done    |
| `tests/conformance/stream.conformance.test.ts`                                                   | Duplex adapter behavior compared against `ws`                                                                                                    | done    |
| `tests/conformance/close.conformance.test.ts`                                                    | `close(code, reason)` argument handling compared against `ws`                                                                                    | done    |
| `tests/tooling/oxlint-plugin.test.ts`                                                            | Anti-OOP, enum, and emoji lint rules                                                                                                             | done    |
| `tests/types/**`                                                                                 | Compile-time public surface, every event-map entry, state records                                                                                | done    |
| `tests/declarations/**`                                                                          | Built declarations through the package `exports` map                                                                                             | done    |
| `tests/conformance/**`                                                                           | The same scenario run against `ws` and ventijs, comparing observable behavior                                                                    | partial |
| `bench/**`                                                                                       | Measured echo throughput against `ws` on the same host, with provenance                                                                          | done    |
| `tests/autobahn/**`                                                                              | RFC 6455 conformance through the digest-pinned fuzzing client                                                                                    | done    |
| `tests/autobahn/{shard-plan,shard-weights,diff-gate,run-options}.test.ts`                        | The shard partition, the weight table's self-check, the skip decision, and the flag parser                                                       | done    |
| `src/engine-tests/socket/connections_test.zig`                                                   | The payload boundary with two live connections, which the Autobahn suite cannot reproduce                                                        | done    |
