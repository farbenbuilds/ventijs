# ws API items and their ventijs modules

Every item named in the vendored reference at [ventijs.md](ventijs.md), the
module that implements it, and its status. The status vocabulary is defined in
[compliance.md](compliance.md). The two socket routes are named throughout:

- **upgrade route**: `WebSocketServer` builds a Node `http.Server`, answers the
  `upgrade` request in `src/compat/server/upgrade.ts`, and adopts the resulting
  `Duplex` in `src/compat/socket/attach.ts`. Nothing reads frames from that
  stream.
- **engine route**: a socket created by `attachNativeSocket` in
  `src/compat/socket/attach.ts`, reached from `src/binding/socket.ts` and the
  engine. The engine parses frames in Zig; JavaScript sees only lifecycle
  events.

## `WebSocketServer`

| Item                                              | Module                                            | Status | Note                                                 |
| ------------------------------------------------- | ------------------------------------------------- | ------ | ---------------------------------------------------- |
| `new WebSocketServer(options[, callback])`        | `src/compat/constructors.ts`, `server/server.ts`  | `done` | `new` shape and the no-`new` `TypeError` both pinned |
| `EventEmitter`-shaped method surface              | `src/compat/events/emitter.ts`                    | `done` | Methods named below                                  |
| `server.address()`                                | `src/compat/server/close.ts`                      | `done` | Throws in `noServer` mode, as `ws` does              |
| `server.close([callback])`                        | `src/compat/server/close.ts`                      | `done` | Second `close` on a stopped server, as `ws` does     |
| `server.handleUpgrade(request, socket, head, cb)` | `src/compat/server/{upgrade,accept,handshake}.ts` | `done` | Byte-for-byte against `ws`                           |
| `server.shouldHandle(request)`                    | `src/compat/server/upgrade.ts`                    | `done` | Path match ignores the query string, as `ws` does    |
| Event `connection`                                | `src/compat/server/{accept,listeners}.ts`         | `done` | Upgrade route only                                   |
| Event `listening`                                 | `src/compat/server/listeners.ts`                  | `done` |                                                      |
| Event `close`                                     | `src/compat/server/close.ts`                      | `done` | Latched before dispatch, once                        |
| Event `error`                                     | `src/compat/server/listeners.ts`                  | `done` | From the Node HTTP server                            |
| Event `headers`                                   | `src/compat/server/accept.ts`                     | `done` | Emitted before the 101 response is written           |
| Event `wsClientError`                             | `src/compat/server/handshake.ts`                  | `done` | Handshake rejections                                 |

Tests backing the `done` rows above: `tests/compat/server/server.test.ts`,
`tests/compat/server/upgrade.test.ts`, `tests/compat/server/upgrade-policy.test.ts`,
`tests/compat/events/emitter.test.ts`, `tests/compat/events/emitter-parity.test.ts`,
`tests/compat/options/{normalization,server}.test.ts`,
`tests/conformance/upgrade.conformance.test.ts`,
`tests/conformance/options.conformance.test.ts`.

The emitter surface is `on`, `once`, `off`, `addListener`, `removeListener`,
`prependListener`, `prependOnceListener`, `emit`, `removeAllListeners`,
`listeners`, `rawListeners`, `eventNames`, `listenerCount`, `getMaxListeners`,
and `setMaxListeners`, on the server and on the socket.

### Server options

| Option group                                            | Module                                                                        | Status    | Note                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host`, `port`, `backlog`, `server`, `noServer`, `path` | `src/compat/options/server.ts`                                                | `done`    | Exactly one listen target, or the `ws` `TypeError`; `server/close.ts` reads them                                                                                                                                                                                                                 |
| `clientTracking`                                        | `src/compat/server/{accept,close,clients}.ts`                                 | `done`    | Governs tracking and server `close`                                                                                                                                                                                                                                                              |
| `verifyClient`, `handleProtocols`, `WebSocket`          | `src/compat/server/{handshake,upgrade,accept}.ts`                             | `done`    | Hardened beyond `ws`; see the divergence note in `COMPATIBILITY.md`                                                                                                                                                                                                                              |
| `autoPong`                                              | `src/compat/options/{server,client}.ts`, `src/compat/socket/codec-inbound.ts` | `done`    | Read on both routes. The codec answers a ping before the application hears about it, which section 5.5.2 requires, and `autoPong: false` suppresses the reply for an application that answers itself                                                                                             |
| `allowSynchronousEvents`                                | `src/compat/options/{server,client}.ts`                                       | `partial` | Normalized and not read. Events are emitted synchronously, which is this option's default value; a caller who sets `false` expecting the events deferred to a later tick will see no difference                                                                                                  |     |
| `maxPayload`                                            | `src/compat/options/server.ts`                                                | `partial` | Normalised, then never read; the compiled 32 KiB cap applies, and a codec has the compiled capacity because its message buffer is comptime-sized                                                                                                                                                 |
| `skipUTF8Validation`                                    | `src/compat/options/server.ts`, `src/engine/codec/utf8.zig`                   | `partial` | The codec validates every text payload and refuses a bad one with 1007; the option is not read, so validation cannot be switched off                                                                                                                                                             |
| `perMessageDeflate`                                     | `src/compat/options/shared.ts`, `src/engine/server/connections.zig`           | `partial` | The option reaches the engine and the route negotiates it, but the codec formats and parses without a compressor, so a client offering it still connects uncompressed on the upgrade route                                                                                                       |
| `closeTimeout`                                          | `src/compat/socket/codec-close.ts`                                            | `done`    | A bounded close handshake on both routes. A peer that receives a close frame and never answers one is torn down and reports 1006, rather than holding its transport and codec slot for the life of the process. `@types/ws` declares no such option, so it is read at runtime like `ws` reads it |
| `maxBufferedChunks`, `maxFragments`                     | none                                                                          | `partial` | Absent from `server.options`, where `ws` reports numbers. Both are internal `ws` limits on fragmentation and queueing rather than behaviours a caller can observe, and the codec bounds both without them                                                                                        |     |

Option normalisation is covered by `tests/compat/options/{normalization,server,client}.test.ts`
and compared with `ws` by `tests/conformance/options.conformance.test.ts`.

## `WebSocket`

| Item                                        | Module                                                                           | Status     | Note                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new WebSocket(null, protocols, options)`   | `src/compat/socket/socket.ts`                                                    | `done`     | The server-side record, as the upgrade route builds it                                                                                                                                                                                                                                              |
| `new WebSocket(address, ...)`               | `src/compat/socket/socket.ts`, `src/compat/client/**`                            | `done`     | Opens a `net` or `tls` connection, writes the handshake, checks every field of the 101, and hands the socket to a client-role codec. follows redirects when asked, and hands the socket to a client-role codec                                                                                      |
| Ready-state constants                       | `src/compat/{ready-state,constructors}.ts`                                       | `done`     | On the constructor and the record                                                                                                                                                                                                                                                                   |
| `addEventListener`, `removeEventListener`   | `src/compat/events/dom-listeners.ts`                                             | `done`     | `once` and `capture` options                                                                                                                                                                                                                                                                        |
| `onopen`, `onerror`, `onclose`, `onmessage` | `src/compat/events/dom-listeners.ts`                                             | `done`     | Wired and compared with `ws`; `onmessage` fires on the upgrade route because the codec delivers its payloads                                                                                                                                                                                        |
| `binaryType`                                | `src/compat/socket/record.ts`                                                    | `partial`  | The value round-trips, including `blob`. The shape a binary message arrives in follows the setting, and `fragments` is the one value that cannot be honoured because the codec does not expose per-fragment payloads                                                                                |
| `readyState`                                | `src/compat/socket/state.ts`                                                     | `done`     |                                                                                                                                                                                                                                                                                                     |
| `send(data[, options][, callback])`         | `src/compat/socket/{send,codec-send}.ts`                                         | `done`     | Framed by the codec and written to the transport on both routes. A failure on an open socket emits `error` once and closes; a send on a socket that is not open reports through the callback and changes nothing, as `ws` does                                                                      |
| `close([code[, reason]])`                   | `src/compat/socket/{lifecycle,close-reason,codec-close}.ts`                      | `done`     | Argument handling, including the order of the length check against the type check, matches `ws`; the close frame is framed and written, and the socket stays `CLOSING` until the peer's frame arrives or `closeTimeout` expires, so a completed handshake and an abandoned one stay distinguishable |
| `ping`, `pong`                              | `src/compat/socket/{control,codec-outbound}.ts`                                  | `partial`  | Arguments and the RFC 6455 125-byte control cap are validated and compared against `ws`, and the frame is written through the codec. The engine's topic publisher still maps a message onto a text or binary opcode, so a control frame cannot cross the engine route                               |
| `terminate`                                 | `src/compat/socket/transport.ts`                                                 | `done`     | Latches `CLOSING` before destroying, as `ws` does; the socket then finishes on the transport's `close` event                                                                                                                                                                                        |
| `pause`, `resume`                           | `src/compat/socket/gating.ts`                                                    | `done`     | A native attachment goes through the engine transition and a transport-owned socket pauses its own stream, so a paused socket stops receiving rather than only reporting that it is                                                                                                                 |
| `bufferedAmount`                            | `src/compat/socket/{payload,queued}.ts`                                          | `done`     | The engine route counts its staging ring and a transport-owned socket reads the transport's own queue, read live rather than cached                                                                                                                                                                 |
| `isPaused`                                  | `src/compat/socket/gating.ts`                                                    | `done`     | Readable immediately after the call on both routes, because the latch happens before the transport or engine transition                                                                                                                                                                             |
| `protocol`, `extensions`, `url`             | `src/compat/socket/state.ts`                                                     | `done`     | The client sets all three from the handshake: the URL as parsed, the subprotocol the peer chose, and the extensions the peer claimed                                                                                                                                                                |
| Event `open`                                | `src/compat/socket/attach.ts`                                                    | `done`     | Both routes                                                                                                                                                                                                                                                                                         |
| Event `close`                               | `src/compat/socket/lifecycle.ts`                                                 | `done`     | Exactly once, terminal state latched first                                                                                                                                                                                                                                                          |
| Event `error`                               | `src/compat/socket/lifecycle.ts`                                                 | `done`     | Emitted, then the socket is finished                                                                                                                                                                                                                                                                |
| Event `message`                             | `src/engine/server/connections.zig`, `src/compat/socket/codec-inbound.ts`        | `partial`  | The engine route fires it and `tests/binding/socket-echo.test.ts` proves the round trip. The upgrade route fires it from the codec, with a real `ws` peer on both sides                                                                                                                             |
| Event `ping`, Event `pong`                  | `src/compat/socket/{control,codec-inbound}.ts`, `src/engine/ffi/socket_pump.zig` | `partial`  | Argument handling and the RFC 6455 125-byte cap are pinned against `ws`. The frame cannot cross the engine's topic publisher, which maps a message onto a text or binary opcode only; the pump now refuses a control record rather than publishing it as a binary message                           |
| Events `redirect`, `unexpected-response`    | `src/compat/client/redirect.ts`                                                  | `partial`  | `redirect` and `unexpected-response` fire, and `followRedirects` drives the hops. Both are narrowed to the URL, and the status, because this client owns a `net.Socket` and has no `http.ClientRequest` to hand over. `upgrade`, which carries the `IncomingMessage` of the 101, is not emitted     |
| IPC connections                             | none                                                                             | `deferred` | `fd` transport is part of the client constructor                                                                                                                                                                                                                                                    |

Tests backing the `done` rows above: `tests/compat/socket/socket.test.ts`,
`tests/compat/socket/close.test.ts`, `tests/compat/socket/payload.test.ts`,
`tests/compat/socket/upgrade-route.test.ts`, `tests/compat/events/dom-listeners.test.ts`,
`tests/compat/events/dom-parity.test.ts`,
`tests/conformance/close.conformance.test.ts`. The engine-route halves of the
`partial` rows are covered by `tests/binding/socket.test.ts` and
`tests/binding/socket-boundary.test.ts`, which drive a live native connection.

`tests/compat/socket/upgrade-route.test.ts` is the suite for the route a
`WebSocketServer`-produced socket actually takes, which no other file exercised:
it builds a socket with a live transport and no native attachment and pins the
three behaviours that route owns, which are that `close()` reaches `CLOSED`, that
a transport failure arrives as `error` even when an earlier recoverable report
burned the latch, and that `bufferedAmount` does not climb without bound.

## `createWebSocketStream`

| Item                                   | Module                 | Status | Note                                                                                     |
| -------------------------------------- | ---------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `createWebSocketStream(ws[, options])` | `src/compat/stream.ts` | `done` | Duplex adapter compared against `ws`; readable side is inert while `message` never fires |

Covered by `tests/compat/stream.test.ts` and, against `ws`, by
`tests/conformance/stream.conformance.test.ts`.
