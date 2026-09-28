# Moving from `ws` to ventijs

`ws` is the compatibility contract, and this document is the short version of where
that holds and where it does not. The itemised matrix with a module and an evidence
test behind every row is [COMPATIBILITY.md](../COMPATIBILITY.md); this is the part a
team reads before deciding.

## The shape of the change

The import specifier is the whole migration for most code:

```diff
-import { WebSocketServer } from "ws";
+import { WebSocketServer } from "ventijs";
```

`ws` is CommonJS with `module.exports = WebSocket` and the rest hung off it. ventijs
is a module namespace, so in CommonJS the class is a named export:

```ts
// ESM, and TypeScript under any resolution mode
import { WebSocket, WebSocketServer } from "ventijs";

// CommonJS
const { WebSocket, WebSocketServer } = require("ventijs");
```

`require("ventijs")` also returns the `WebSocket` class itself, with the named exports
attached, so `const WebSocket = require("ventijs")` works. The TypeScript _type_ for
that form is the namespace rather than the class, so a TypeScript CommonJS consumer
wants the named import.

Both `import` and `require` conditions are published, with `types` under each, and
`tests/declarations/consumer.cts` compiles against the `require` path with
`moduleResolution: node16` and `skipLibCheck: false` so the condition cannot rot.

## Two things worth knowing before you start

### The engine route is capped at 64 KiB

`ws` defaults `maxPayload` to 100 MiB, and the codec route honours it: the option is
enforced per connection, up to 100 MiB, and a peer that sends more gets close code 1009. Buffers grow into that ceiling on demand rather than being allocated at open, so
a connection costs what it sends rather than what it is allowed to send.

The engine route is separate and still compiled: `message_capacity` is a `comptime`
constant of 64 KiB in `src/engine/server/capacities.zig`, the Autobahn suite's largest
group-1 payload, and a larger frame is refused with 1009. `maxPayload` does not raise
it. It is reported rather than restated, so a caller can read the number:

```ts
import { engineLimits } from "ventijs";

console.log(engineLimits().messageBytes); // 65536
```

Raising it is a one-line change, at roughly 20 MiB per live server, because the
message slab, the write queue, the RFC 7692 scratch, the cluster inbox, and both
staging rings all scale with it.

### `perMessageDeflate` is on, with one deliberate difference

Compression works on both routes, negotiated with `ws`'s own rules, over the pinned
engine's libdeflate. Two things differ, and both are about the compressor being
one-shot rather than a streaming zlib:

- Both directions always answer `server_no_context_takeover; client_no_context_takeover`.
  Carrying a deflate window between messages needs a streaming compressor. Declining is
  always legal and costs compression ratio, not correctness, and it means a message
  never depends on the one before it.
- A `*_max_window_bits` below 15 is **declined during negotiation**, which for a client
  means the handshake is refused. `ws` accepts one because its zlib can produce it;
  accepting it here would mean compressing with a different window than the one agreed,
  and the peer's inflater would reject the stream mid-message.

A message you send in fragments goes out uncompressed, for the same reason: RFC 7692
needs a sync flush at each fragment boundary. Messages you _receive_ fragmented and
compressed are read correctly, so interoperability is unaffected in both directions.

## What is deliberately different

Each is recorded in [COMPATIBILITY.md](../COMPATIBILITY.md) with the `ws` behaviour it
replaces. Most are a refusal to do something unsafe; two are stricter limits and one
is an addition.

- **A `WebSocket` subclass that is not a ventijs socket record** fails with
  `ERR_INVALID_HANDLE` from inside an `upgrade` listener, where `ws` fails with a
  `TypeError`. Pass `WebSocket` itself, or a record ventijs built.
- **A bad close still closes.** `ws` latches `CLOSING` before it validates, so a
  refused code or reason leaves the socket closing; ventijs matches that.
- **`reason === null`** is treated as an absent reason. `ws` rejects it with a
  V8-internal `TypeError` from reading `.length` off it.
- **`closeTimeout` is validated.** A non-number or a negative value is a `RangeError`
  from the constructor, where `ws` coerces it through `setTimeout`.
- **A rejected handshake is hardened.** A `handleProtocols` result that is not a token
  is refused instead of echoed into a response header; control characters in
  `verifyClient` headers and status codes are dropped; a rejection status outside
  400-599 is clamped to 500, where `ws` writes the literal string
  `HTTP/1.1 700 undefined`.
- **`maxBufferedChunks` is not enforced.** It is echoed on `server.options` at the
  `ws` default so `Object.keys(server.options)` matches, but the codec holds at most
  one read's un-decoded tail, which is already far below the 262144 `ws` bounds.
  Lowering it changes nothing; `maxFragments` and `maxPayload` are the limits that
  do something.
- **Errors carry a stable `code`.** A refused frame reports `ws`'s own `WS_ERR_*`
  code, constructor, and message, so a caller keying on `error.code` reads what it
  always did. Where `ws` reports nothing, ventijs adds an `ERR_*` code.

## Testing against both

The compatibility harness runs the same scenario against `ws` and against ventijs and
compares the observable outcome, so a divergence shows up as a test failure rather
than as a production surprise. `ws` is a devDependency only, so the installed package
depends on `napi-zig` and the engine alone.

```sh
pnpm test          # every suite, after rebuilding the addon
pnpm test:compat   # the side-by-side conformance suites only
pnpm test:autobahn # the RFC 6455 suite, needs a Docker-capable host
pnpm bench         # measured echo throughput against ws on this host
```
