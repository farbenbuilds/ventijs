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

| Option group                                            | Module                                                              | Status    | Note                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host`, `port`, `backlog`, `server`, `noServer`, `path` | `src/compat/options/server.ts`                                      | `done`    | Exactly one listen target, or the `ws` `TypeError`; `server/close.ts` reads them                                                                                                           |
| `clientTracking`                                        | `src/compat/server/{accept,close,clients}.ts`                       | `done`    | Governs tracking and server `close`                                                                                                                                                        |
| `verifyClient`, `handleProtocols`, `WebSocket`          | `src/compat/server/{handshake,upgrade,accept}.ts`                   | `done`    | Hardened beyond `ws`; see the divergence note in `COMPATIBILITY.md`                                                                                                                        |
| `allowSynchronousEvents`, `autoPong`                    | `src/compat/options/server.ts`                                      | `partial` | Normalised into the option record, then never read                                                                                                                                         |
| `maxPayload`                                            | `src/compat/options/server.ts`                                      | `partial` | Normalised, then never read; the engine's compiled 32 KiB cap applies                                                                                                                      |
| `skipUTF8Validation`                                    | `src/compat/options/server.ts`                                      | `partial` | Normalised, then never read; validation is the engine's                                                                                                                                    |
| `perMessageDeflate`                                     | `src/compat/options/shared.ts`, `src/engine/server/connections.zig` | `partial` | The option now reaches the engine and the route negotiates it, but the facade's upgrade route has no frame codec to compress on, so a client offering it still connects uncompressed there |
| `maxBufferedChunks`, `maxFragments`, `closeTimeout`     | none                                                                | `partial` | Absent from `server.options`, where `ws` reports numbers                                                                                                                                   |

Option normalisation is covered by `tests/compat/options/{normalization,server,client}.test.ts`
and compared with `ws` by `tests/conformance/options.conformance.test.ts`.

## `WebSocket`

| Item                                                | Module                                                           | Status     | Note                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new WebSocket(null, protocols, options)`           | `src/compat/socket/socket.ts`                                    | `done`     | The server-side record, as the upgrade route builds it                                                                                                                                                                                                                                                         |
| `new WebSocket(address, ...)`                       | `src/compat/socket/socket.ts`                                    | `deferred` | Throws `ERR_INVALID_STATE`; the client is not implemented                                                                                                                                                                                                                                                      |
| Ready-state constants                               | `src/compat/{ready-state,constructors}.ts`                       | `done`     | On the constructor and the record                                                                                                                                                                                                                                                                              |
| `addEventListener`, `removeEventListener`           | `src/compat/events/dom-listeners.ts`                             | `done`     | `once` and `capture` options                                                                                                                                                                                                                                                                                   |
| `onopen`, `onerror`, `onclose`, `onmessage`         | `src/compat/events/dom-listeners.ts`                             | `partial`  | Wired and compared with `ws`; `onmessage` cannot fire, because the upgrade route delivers no payload                                                                                                                                                                                                           |
| `binaryType`                                        | `src/compat/socket/socket.ts`                                    | `partial`  | The value round-trips, including `blob`; no payload is ever delivered on the upgrade route                                                                                                                                                                                                                     |
| `readyState`                                        | `src/compat/socket/state.ts`                                     | `done`     |                                                                                                                                                                                                                                                                                                                |
| `send(data[, options][, callback])`                 | `src/compat/socket/send.ts`                                      | `partial`  | Only a natively attached socket reaches the wire, and nothing in `src/compat/` attaches one, so every public socket reports `ERR_INVALID_STATE`. A failure on an open socket emits `error` once and closes; a send on a socket that is not open reports through the callback and changes nothing, as `ws` does |
| `close([code[, reason]])`                           | `src/compat/socket/{lifecycle,close-reason}.ts`                  | `partial`  | Argument handling, including the order of the length check against the type check, matches `ws`; the close frame is not written on the upgrade route, which now destroys the transport so the socket reaches `CLOSED` rather than stranding at `CLOSING`                                                       |
| `ping`, `pong`                                      | `src/compat/socket/control.ts`                                   | `partial`  | Arguments and the RFC 6455 125-byte control cap validated and compared against `ws`; the frame itself is not staged                                                                                                                                                                                            |
| `terminate`                                         | `src/compat/socket/transport.ts`                                 | `partial`  | Latches `CLOSING` before destroying, as `ws` does; the socket then finishes on the transport's `close` event                                                                                                                                                                                                   |
| `pause`, `resume`                                   | `src/compat/socket/gating.ts`                                    | `partial`  | Latch the facade; the engine transition needs a native attachment                                                                                                                                                                                                                                              |
| `bufferedAmount`                                    | `src/compat/socket/payload.ts`                                   | `partial`  | Counts staged bytes on the engine route; static on the upgrade route                                                                                                                                                                                                                                           |
| `isPaused`                                          | `src/compat/socket/lifecycle.ts`                                 | `partial`  | Facade state only                                                                                                                                                                                                                                                                                              |
| `protocol`, `extensions`, `url`                     | `src/compat/socket/state.ts`                                     | `partial`  | Keep the server-side defaults                                                                                                                                                                                                                                                                                  |
| Event `open`                                        | `src/compat/socket/attach.ts`                                    | `done`     | Both routes                                                                                                                                                                                                                                                                                                    |
| Event `close`                                       | `src/compat/socket/lifecycle.ts`                                 | `done`     | Exactly once, terminal state latched first                                                                                                                                                                                                                                                                     |
| Event `error`                                       | `src/compat/socket/lifecycle.ts`                                 | `done`     | Emitted, then the socket is finished                                                                                                                                                                                                                                                                           |
| Event `message`                                     | `src/engine/server/connections.zig`                              | `partial`  | Engine route fires it and `tests/binding/socket-echo.test.ts` proves the round trip; no emitter on the upgrade route                                                                                                                                                                                           |
| Event `ping`, Event `pong`                          | `src/compat/socket/control.ts`, `src/engine/ffi/socket_pump.zig` | `partial`  | Argument handling and the RFC 6455 125-byte cap are pinned against `ws`. The frame cannot cross the engine's topic publisher, which maps a message onto a text or binary opcode only; the pump now refuses a control record rather than publishing it as a binary message                                      |
| Events `redirect`, `unexpected-response`, `upgrade` | none                                                             | `deferred` | Client-scope events; no client exists to emit them                                                                                                                                                                                                                                                             |
| IPC connections                                     | none                                                             | `deferred` | `fd` transport is part of the client constructor                                                                                                                                                                                                                                                               |

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
