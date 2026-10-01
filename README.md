<p align="center">
  <img src="misc/ventiws_banner.png" alt="ventiws banner" />
</p>

# ventiws

A WebSocket implementation for Node.js with the API of
[`ws`](https://github.com/websockets/ws), delivered as a native addon whose framing
engine is written in Zig. It targets `ws` 8.21.3 and reproduces that release's
observable behaviour rather than its source. ventiws is not affiliated with the
`ws` project and vendors none of its code; the upstream API reference is vendored
as the pinned contract, credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**ventiws is at `1.0.0-beta.2`.** The surface may change between beta
releases. What "beta" means here is bounded: the `ws` compatibility
contract is tracked row by row in
[COMPATIBILITY.md](COMPATIBILITY.md), and the four places ventiws knowingly
differs from `ws` are listed in [CHANGELOG.md](CHANGELOG.md) under "Known
divergences from `ws`".

## Install

```sh
pnpm add ventiws
```

The addon arrives as a per-platform package that npm installs only on a host
it matches, so the install needs no compiler:

| Platform                    | Package                            |
| --------------------------- | ---------------------------------- |
| Linux x64, glibc            | `@ventiws/binding-linux-x64-gnu`   |
| Linux x64, musl (Alpine)    | `@ventiws/binding-linux-x64-musl`  |
| Linux arm64, glibc          | `@ventiws/binding-linux-arm64-gnu` |
| macOS x64                   | `@ventiws/binding-darwin-x64`      |
| macOS arm64 (Apple silicon) | `@ventiws/binding-darwin-arm64`    |

Any other host installs ventiws with no addon behind it, and the first
`WebSocketServer` says so by name and lists the platforms above.

**Windows is not supported yet, at either layer.** There is no published addon,
because the pinned `napi-zig` asks the build for an ABI-less
`x86_64-windows-none` that has no `ws2_32` to link. More fundamentally, the
engine cannot serve a socket there: its listener binds and the kernel accepts,
then the event loop fails `accept` and `read` with `error.Unexpected`, and the
peer is reset. Building in a checkout does not change that, so a Windows
checkout is a place to edit the code, not to run a server. The frame codec
itself is platform-independent and its suites do pass there.

Working in the tree:

```sh
git clone git@github.com:farbenbuilds/ventiws.git
cd ventiws
direnv allow
pnpm install
pnpm build
```

`direnv allow` runs `.envrc`, which enters the pinned Nix shell with Node.js,
pnpm, and Zig 0.16.0, and re-enters it on every later `cd`. Without
[direnv](https://direnv.net) installed, run `nix develop` once per shell
instead. The first `pnpm build` compiles the vendored C dependencies, which
takes minutes and about a gigabyte; later builds are incremental.

## Usage

```ts
import { WebSocket, WebSocketServer } from "ventiws";

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

Both halves run against a real `ws` peer in this repository's suites, and the
constructors are plain functions returning state records: no `class`, no `this`,
no prototype.

### Dev logger

ventiws prints lifecycle records as they happen: the splash when a server starts
listening, then open, close, and error records for every connection, with no
callbacks to subscribe. It is a zero-dependency ANSI module outside the `ws`
surface, on by default, and silenced with one switch.

```ts
import { setLoggerEnabled } from "ventiws/logging";

setLoggerEnabled(false); // VENTIWS_LOG=0 does the same at load
```

The record format, every recorded moment, and the manual API are in
[docs/logging.md](docs/logging.md).

## Status

Option defaults match `ws`: `maxPayload` 100 MiB, `maxFragments` 16384, and
`closeTimeout` 30000 ms. The itemised matrix, with the owner module and the
evidence test behind every row, is [COMPATIBILITY.md](COMPATIBILITY.md).

| Area                                                                                | State                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `WebSocketServer`: options, events, `handleUpgrade`, `shouldHandle`, `verifyClient` | Works, compared property for property against `ws`                                                                                |
| Server-side `WebSocket`: properties, `on*` and DOM handlers, ready states           | Works, with exactly-once `close`                                                                                                  |
| `WebSocket` client: `net` and `tls`, redirects, `ws+unix:`, `unexpected-response`   | Works against a real `ws` server                                                                                                  |
| `send`, fragmentation, `binaryType`, `ping`/`pong`, close codes                     | Works both directions; `maxPayload` and `maxFragments` are enforced per connection                                                |
| `permessage-deflate`                                                                | Works; context takeover is declined in both directions ([why](COMPATIBILITY.md#shared-with-the-engine))                           |
| `createWebSocketStream`, `clientTracking`, `server.options`                         | Works, including the `WebSocket` class option                                                                                     |
| Engine route message cap, 64 KiB                                                    | A property of the build. [Two limits](#two-limits-worth-knowing)                                                                  |
| Engine route inbound ring, 64 messages                                              | Excess is dropped and counted. Same section                                                                                       |
| RFC 6455 Autobahn suite                                                             | Regression gate; 424 of 517 cases in the full run, 268 in the framing selection ([matrix](COMPATIBILITY.md#rfc-6455-conformance)) |
| Client `wss:` to `ws:` downgrade, redirect hop limit, `origin`, `handshakeTimeout`  | Implemented with no behavioural test ([outstanding](COMPATIBILITY.md#what-is-still-outstanding))                                  |

## Two limits worth knowing

**The 64 KiB message cap.** `message_capacity` in
`src/engine/server/capacities.zig` is a `comptime` constant, so it is baked into
the addon: `maxPayload` sizes each connection's own ceiling and does not lift this
one. 64 KiB is the largest payload the conformance suite puts on the wire, and a
frame above it is closed with 1009. Raising it costs about 22 MB per live server,
because the message slab, the write queue, and both staging rings scale with it.

**The 64-slot inbound ring.** The engine has no hook for stopping a read when its
consumer falls behind, so the ring in `src/engine/server/instance.zig` is the
only place a burst can be absorbed. It holds 64 messages, and a peer delivering
more before the Node main thread drains has the excess dropped and counted by
`serverDroppedMessages`. `ws` applies backpressure instead, so it has no cliff.

Both bind the engine route, which is µWebZockets' own listener. The codec route
the public `ws` surface uses is bound by neither: its buffers grow into each
connection's own `maxPayload` and `maxFragments`. `engineLimits()` is exported
from the package entry, so the compiled numbers are readable at runtime.

## Commands

```sh
pnpm build
pnpm test
pnpm test:compat
pnpm test:autobahn
pnpm bench
pnpm typecheck
pnpm lint
pnpm format:check
```

## Docs and licence

- [COMPATIBILITY.md](COMPATIBILITY.md): every `ws` surface item, its owner module, its status, and its evidence test.
- [CODEBASE.md](CODEBASE.md): repository layout, the two routes, the boundary, and the compiled capacities.
- [CODING_CONVENTION.md](CODING_CONVENTION.md): TypeScript and Zig style, the anti-OOP rules, and the module budget.
- [docs/migrating.md](docs/migrating.md): moving an existing `ws` application over.
- [docs/logging.md](docs/logging.md): the opt-in dev logger and startup splash.
- [CONTRIBUTE.md](CONTRIBUTE.md): environment setup, the script contract, and how to release.

MIT. See [LICENSE](LICENSE). `ws` is copyright Einar Otto Stangvik, Arnout
Kazemier, and contributors, MIT-licensed. µWebZockets is the first-party
MIT-licensed protocol engine written for this project. Provenance for everything
vendored or CI-only is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
