# Moving from `ws` to ventiws

`ws` is the compatibility contract, and this document is the short version of where
that holds and where it does not. The itemised matrix with a module and an evidence
test behind every row is [COMPATIBILITY.md](../COMPATIBILITY.md); this is the part a
team reads before deciding.

## The shape of the change

The import specifier is the whole migration for most code:

```diff
-import { WebSocketServer } from "ws";
+import { WebSocketServer } from "ventiws";
```

`ws` is CommonJS with `module.exports = WebSocket` and the rest hung off it. ventiws
is a module namespace, so in CommonJS the class is a named export:

```ts
// ESM, and TypeScript under any resolution mode
import { WebSocket, WebSocketServer } from "ventiws";

// CommonJS
const { WebSocket, WebSocketServer } = require("ventiws");
```

`require("ventiws")` also returns the `WebSocket` class itself, with the named exports
attached, so `const WebSocket = require("ventiws")` works. The TypeScript _type_ for
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
import { engineLimits } from "ventiws";

console.log(engineLimits().messageBytes); // 65536
```

Raising it is a one-line change, at roughly 20 MiB per live server, because the
message slab, the write queue, the RFC 7692 scratch, the cluster inbox, and both
staging rings all scale with it.

### `perMessageDeflate` is on, with one deliberate difference

Compression works on both routes, negotiated with `ws`'s own rules, over the pinned
engine's libdeflate. Two things differ, and both are about the compressor being
one-shot rather than a streaming zlib; the third point below used to differ and now
matches `ws`:

- Both directions always answer `server_no_context_takeover; client_no_context_takeover`.
  Carrying a deflate window between messages needs a streaming compressor. Declining is
  always legal and costs compression ratio, not correctness, and it means a message
  never depends on the one before it.
- A `server_max_window_bits` below 15 is **declined during negotiation**, which for a
  client means the handshake is refused. This is the only difference from `ws` left in the
  module: `ws` accepts one, answers it, and then compresses at 15 regardless, so its
  header claims a window the stream does not use. Declining is the honest reading, and
  answering it would mean compressing with a different window than the one agreed, which
  the peer's inflater would reject mid-message.
- A `client_max_window_bits` at any legal value is **accepted**. In a client offer it is
  the window the client will compress with, not a limit on this server (RFC 7692 section
  7.1.1.2), and the inflater reads the window out of the stream, so a 10-bit client is
  fine to serve. `ws` agrees, and ventiws used to refuse it with a bare 400.

A message you send in fragments goes out uncompressed, for the same reason: RFC 7692
needs a sync flush at each fragment boundary. Messages you _receive_ fragmented and
compressed are read correctly, so interoperability is unaffected in both directions.

## What is deliberately different

Each is recorded in [COMPATIBILITY.md](../COMPATIBILITY.md) with the `ws` behaviour it
replaces. Most are a refusal to do something unsafe, two are a difference `ws` has
with its own types, one is a stricter limit, and one is an addition.

- **A `WebSocket` subclass that is not a ventiws socket record** fails with
  `ERR_INVALID_HANDLE` from inside an `upgrade` listener, where `ws` fails with a
  `TypeError`. Pass `WebSocket` itself, or a record ventiws built.
- **A bad close still closes.** `ws` latches `CLOSING` before it validates, so a
  refused code or reason leaves the socket closing; ventiws matches that.
- **`reason === null`** is treated as an absent reason. `ws` rejects it with a
  V8-internal `TypeError` from reading `.length` off it.
- **`closeTimeout` is validated.** A non-number or a negative value is a `RangeError`
  from the constructor, where `ws` coerces it through `setTimeout`.
- **A rejected handshake is hardened.** A `handleProtocols` result that is not a token
  is refused instead of echoed into a response header; control characters in
  `verifyClient` headers and status codes are dropped; a rejection status outside
  400-599 is clamped to 500, where `ws` writes the literal string
  `HTTP/1.1 700 undefined`.
- **Errors carry a stable `code`.** A refused frame reports `ws`'s own `WS_ERR_*`
  code, constructor, and message, so a caller keying on `error.code` reads what it
  always did. Where `ws` reports nothing, ventiws adds an `ERR_*` code.

Three more are the ones a caller is most likely to hit, because each changes what a
`ws` application sends or receives rather than what it is allowed to do:

- **A `wss:` to `ws:` redirect is refused.** ventiws answers
  `Cannot follow a redirect from wss: to ws:` and never contacts the destination.
  `ws` follows the hop, after deleting `authorization`, `cookie` and `auth`. If your
  deployment relies on that hop, it will fail here.
- **`url` on a socket a server accepted is `""`,** where `ws` gives `undefined`.
  `"url" in socket` is `true` on both, so only the value tells the two apart, and
  `@types/ws` declares `readonly url: string` anyway, so `ws` disagrees with its own
  types here. `url` is the URL as parsed on a client.
- **`Too many buffered chunks` is reported as `Too many message fragments`.** The
  `error.code` is `WS_ERR_TOO_MANY_BUFFERED_PARTS` and the close code is 1008 on both,
  as in `ws`; only the message differs, and only when the `maxBufferedChunks` bound is
  the one reached. A caller keying on `error.code` is unaffected; a caller matching on
  the message is not.

Two behaviours that used to differ now match `ws` exactly, so they are no longer on the
list, but they are worth knowing about because they change the bytes on the wire: the
library's upgrade headers go over the caller's, a caller's `Authorization` wins over URL
credentials, `origin: ''` sends no `Origin` header, and `handshakeTimeout: 0` means no
deadline. `send(data, { mask: false })` puts an unmasked frame on a client's wire, which
the peer then refuses, exactly as `ws` does, and a server never masks.

## Testing against both

The compatibility harness runs the same scenario against `ws` and against ventiws and
compares the observable outcome, so a divergence shows up as a test failure rather
than as a production surprise. `ws` is a devDependency only, so the installed package
depends on `napi-zig` and the engine alone.

```sh
pnpm test          # every suite, after rebuilding the addon
pnpm test:compat   # the side-by-side conformance suites only
pnpm test:autobahn # the RFC 6455 suite, needs a Docker-capable host
pnpm bench         # measured echo throughput against ws on this host
```
