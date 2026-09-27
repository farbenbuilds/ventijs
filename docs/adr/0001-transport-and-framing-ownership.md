# ADR 0001: the transport stays on Node, the framing moves to Zig

- Status: accepted
- Date: 2026-09-27
- Decides: which layer owns the socket, and which layer owns RFC 6455 framing
- Affects: `src/compat/server/**`, `src/compat/socket/**`, `src/engine/**`,
  `src/binding/**`

## Context

ventijs is a drop-in replacement for `ws`. That contract, not a preference, is
what fixes the architecture, and it is worth writing down why, because the
tempting alternative looks better until you check it against `ws`'s surface.

`ws` is built on Node's own networking stack. Its `WebSocketServer` accepts one
of `port`, `server`, or `noServer`; in the last two the caller owns the
`http.Server` and ventijs is a passenger on its `upgrade` event. It exposes
`handleUpgrade` and `shouldHandle` as public methods over Node's
`Duplex`. Its client dials through `http.request` or `https.request`, so it gets
Node's DNS, Node's TLS trust store, Node's proxy and agent handling, and Node's
redirect machinery. A consumer can put a `ventijs` server behind an Express app,
a cluster, a Unix socket, or an `https.Server` with its own certificates, and
expect `ws` behavior.

That means **the transport has to be Node's**. Not "would be preferable", but
"there is no alternative that is still a drop-in replacement". A native engine
that binds its own listener cannot support `noServer`, cannot be handed a
socket the caller already accepted, and has no client.

The pinned engine cannot be moved under the upgrade path even in principle. Its
`WebSocket` is a plain struct, but every field is transport-owned: it holds a
`*TcpConnection`, and that struct's read buffer, request buffer, and write queue
are slices carved from one contiguous slab the engine allocates at startup and
frees at shutdown. There is no per-connection constructor, and no entry point
that accepts a socket, a file descriptor, or a pre-bound listener. `upgrade` is
called from exactly one place in the whole tree, the engine's own HTTP request
dispatcher, and it writes the `101` itself from a `Response` the engine built.
The C ABI mirrors this: every export takes an existing `*WebSocket`.

So the two options `COMPATIBILITY.md` named were both wrong. Reimplementing
RFC 6455 framing in TypeScript over the adopted `Duplex` duplicates the parsing
the architecture says Zig owns, and hands the security-critical half of a network
library to the runtime with the weaker memory story. Reducing `WebSocketServer` to
a `noServer`-shaped shim over `src/binding/server.ts` changes the transport model
of every public server surface and drops the client entirely.

## Decision

**Split transport from framing. Node owns the socket; Zig owns the codec.**

- **Node owns the transport.** TCP and TLS sockets, the HTTP server, the `upgrade`
  event, `handleUpgrade`, `shouldHandle`, DNS, the client request, redirects, and
  the TLS trust store. This is what makes the package drop-in, and it is the layer
  Node is better at than any addon would be.
- **Zig owns the framing.** A pure frame codec behind a Node-API handle, driven
  by the Node stream. It owns header parsing, payload-length validation, masking
  and unmasking, the incremental UTF-8 validator, fragmentation and reassembly,
  control-frame handling and the 125-byte cap, close-code validation, and the
  bounded outbound staging. Every one of those is a place where a bug is a
  protocol violation or a memory-safety problem, which is exactly the class of
  bug that belongs in a language with a bounds checker and no garbage collector
  pauses.
- **Neither layer holds the other's state.** The codec is fed bytes and returns
  events; it never sees a socket, an fd, or a Node object. The stream is never
  asked to parse anything.

This is what `AGENTS.md` already states: "Zig will own parsing, buffers, and
backpressure". What changes is that it will own them as a _codec_ rather than as
a _server_, because the engine cannot be a server for this contract.

## Consequences

**Accepted.**

- The framing work lands in Zig, in a module the existing engine tests can cover
  directly, and it is reusable by the client with no second implementation.
- The engine's compiled capacities and the Node transport are separable, so
  `message_capacity` can be raised for the benchmark harness without touching the
  public surface.
- `WebSocket` gains a client, because a codec plus Node's `net` and `tls` is a
  client, and the engine never had one.

**Rejected, and why.**

- _Framing in TypeScript._ Shippable, and it is the smallest change. It puts
  UTF-8 validation, masking, and length checks in the runtime, where the whole
  point of the project is not to have them there. It also has to be written twice
  if the client ever gets a different path.
- _Fork or vendor-patch the engine to adopt a socket._ Would work, at the cost of
  maintaining a patch against a pinned third-party tree that changes underneath
  it, for a capability the engine does not otherwise need. If the upstream ever
  grows an adoption entry point this ADR should be revisited, because the fork
  becomes unnecessary.
- _Engine binds the listener, Node proxies to it._ Breaks `noServer`, `server`,
  `handleUpgrade`, and `shouldHandle` in one move. That is the end of the
  drop-in property, so it is not a trade-off worth making.

**Consequences to watch.**

- The codec is a second Zig module with its own fixed-capacity state per
  connection. Its capacities have to be named constants like every other one, and
  `engineLimits` has to report them so nothing restates them in TypeScript.
- Per-message `Codec` calls cross the Node-API boundary, so the per-message cost
  is a boundary crossing rather than a function call. The codec's own work
  dominates that, but `bench/` has to measure it rather than assume it.
- Two consumers of one FIFO is the mistake the inbound ring already made once.
  The codec's inbound queue is per connection, which removes the cross-connection
  coupling that produced a server-wide stall, but it also means the connection
  count multiplies the memory. `connection_capacity` is the knob.

## What this does not decide

- Whether the frame codec reuses the vendored `zslay` or reimplements the header
  codec. `zslay` is already a dependency and is correct; if its client role
  cannot be driven incrementally, a thin codec over it beats a second
  implementation.
- How `permessage-deflate` is reached. The engine already negotiates it and
  already reserves the scratch, and the route now registers it, so the codec
  should reuse the engine's deflate context rather than bring its own.
- The `message_capacity` value. Raising it converts six Autobahn group-1 cases
  and costs about 22 MB per server. It is a policy call about the memory the
  project is willing to spend, and it needs one recorded conformance run to
  re-derive the harness's expectations.
