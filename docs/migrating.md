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

## Two limits worth knowing before you start

### Messages are capped at 32 KiB

`ws` defaults `maxPayload` to 100 MiB. ventijs's message buffer is `comptime`-sized at
32 KiB, so the compiled cap is what applies and `maxPayload` is reported at its `ws`
value without being enforced. A peer that sends more gets close code 1009.

`engineLimits().messageBytes` reports the compiled number rather than a copy of it, so
a caller can read the cap instead of guessing:

```ts
import { engineLimits } from "ventijs";

console.log(engineLimits().messageBytes); // 32768
```

This is the one difference most likely to affect a working application, and it is a
cap rather than a behaviour change. Raising it is a one-line change to a `comptime`
constant in `src/engine/codec/capacities.zig`, at a cost of roughly 20 MiB per live
connection for the reassembly buffer and its transmit mirror.

### `perMessageDeflate` is not offered

The option is normalized and reported on `server.options` exactly as `ws` reports it,
and then ignored: a client offering the extension connects uncompressed. The engine
route negotiates it; the codec route has no compressor yet.

If your deployment depends on compression, this is a blocker, and the honest answer is
that it is not implemented rather than the fact that a header round-trips.

## What is deliberately different

Every one of these is a divergence from `ws` in the direction of refusing to do
something unsafe, and each is recorded in [COMPATIBILITY.md](../COMPATIBILITY.md) with
the `ws` behaviour it replaces.

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
- **Errors carry a stable `ERR_*` code.** This is additive: every `ws` error class and
  message is preserved, and a `.code` is added.

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
