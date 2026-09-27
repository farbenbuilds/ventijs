# ws surface compliance map

The upstream `ws` API reference is vendored at [ventijs.md](ventijs.md). This directory maps each item in that reference to the
ventijs module that implements it and to its status. It answers one question,
"What does ventijs actually implement", which the vendored reference
deliberately does not answer.

The pinned contract is `ws` 8.21.3 with `@types/ws` 8.18.1. Both are
devDependencies, so the conformance suite can run the two implementations side
by side. The public type surface is the vendored declaration file
`src/types/ws.d.ts`.

| Document                                                                                   | Question it answers                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [COMPATIBILITY.md](../COMPATIBILITY.md)                                                    | Which behaviour is verified, and by which test?                              |
| [adr/0001-transport-and-framing-ownership.md](adr/0001-transport-and-framing-ownership.md) | Why Node owns the socket and Zig owns the frame codec, and what was rejected |
| [docs/compliance-api.md](compliance-api.md)                                                | Which module implements each `ws` API item?                                  |
| [docs/compliance-error-codes.md](compliance-error-codes.md)                                | Which `WS_ERR_*` codes and environment variables can occur?                  |
| [docs/ventijs.md](ventijs.md)                                                              | What does `ws` do? The contract, not a feature list.                         |

## Status vocabulary

The first four values are the ones
[COMPATIBILITY.md](../COMPATIBILITY.md) uses, with the same meaning. The fifth
is added here because a dozen vendored items have no ventijs counterpart by
construction, and calling them `todo` would imply a plan that does not exist.

| Status        | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `done`        | Implemented and covered by a passing evidence test                              |
| `partial`     | Exists in a limited form; the row names what is missing                         |
| `todo`        | Planned, not implemented                                                        |
| `deferred`    | Out of scope until the named prerequisite lands                                 |
| `unreachable` | No counterpart by construction; the row states the architecture that removes it |

## Rules for these tables

- A row is only `done` when its evidence test exists and passes. A test that is
  written but failing is not evidence.
- Every status is traceable to a module under `src/` and, where one exists, to a
  test under `tests/`. A row with neither is a claim, not a status.
- A row whose behaviour diverges from `ws` says so in the note and names the
  file that records the divergence.
- `partial` is not a polite word for `todo`. It means the surface exists, a
  caller can reach it, and something observable is missing. The note says what.

## Updating these tables

Update the affected row in the same change that moves the status.

`message` and `send` moved together, and they are worth naming because they are
the pair that decides whether a ventijs socket can echo at all. They are
implemented on the engine route, where `src/engine/server/connections.zig` takes
the parsed payload and `src/engine/ffi/socket_pump.zig` moves staged replies onto
the wire, and they are still `todo` on the facade's HTTP upgrade route, which
adopts a raw Node stream and does no framing.

**That second `todo` is the whole of it, and the distinction is not a nuance.** No
file under `src/compat/` calls `createServer`, `listenServer`, `pumpSocket`, or
`takeSocketMessage`. The engine route is reachable only from `tests/binding/`,
`tests/autobahn/`, and `bench/`, so a status that says "implemented on the engine
route" describes the test harness and not the product. Every row in these tables
describes the facade, so a route the facade cannot reach is a `todo`, and a row
whose note mentions the engine route is a row whose real gap is that no public
socket is ever attached to one.

Both of the architectures `COMPATIBILITY.md` used to name here are now settled,
and the decision is recorded as
[ADR 0001](adr/0001-transport-and-framing-ownership.md). A TypeScript receiver
over the adopted `Duplex` was rejected because it duplicates framing the
architecture says Zig will own and hands UTF-8 validation, masking, and length
checks to the runtime. Reducing `WebSocketServer` to a `noServer`-shaped shim was
rejected because it changes the transport model of every public server surface and
drops the client. What replaced both is a third shape: Node keeps the transport,
which is what the drop-in contract requires anyway, and a pure Zig frame codec
behind a Node-API handle takes over parsing, masking, UTF-8, fragmentation,
control frames, and backpressure.

The client is the other half of the same decision and is implemented: Node's
`net`/`tls` own the connection and the codec owns the framing, in the client role,
because a client masks and a server must not. `src/compat/client/` splits the
handshake into the decisions it is made of, and `tests/compat/client/` runs a real
`ws` server as the peer in both directions, the mirror of the upgrade route's suites.

That codec is in place and the upgrade route runs on it.
`src/compat/socket/codec-inbound.ts` folds the transport's bytes into a
server-role codec and dispatches what comes out; `codec-outbound.ts`,
`codec-send.ts`, and `codec-close.ts` frame `send`, `ping`, `pong`, and `close`
on the way out. The route's own defects are fixed as well: `close()` reaches
`CLOSED` rather than stranding the socket at `CLOSING`, a transport failure
reaches the socket as `error` rather than a silent `close(1006)`, a multi-byte
typed array puts every byte it holds on the wire, and `close(code, reason)`
measures the argument before dispatching on its type, which is the order `ws`
uses and which decides the error class a caller sees.

`tests/compat/socket/upgrade-route.test.ts` is the suite for that route's
lifecycling, and `tests/compat/socket/codec-upgrade*.test.ts` runs it against
real `ws` peers in both directions. The second suite is the one that would have
caught the four boundary defects the codec's Node-API surface carried, and its
harness note matters: a `noServer` facade test built on a `ws` server proves only
that `ws` agrees with `ws`, so the server under test has to be ventijs's own.

The inbound ring's starvation defect turned out to be visible in the conformance
report as well. `5.19`, `5.20`, and `7.1.1` were recorded as three separate
failures with three different explanations; the run after the purge passes all
three, which is the evidence that they shared one cause, on the shared inbound
ring, and that the previous three explanations were all symptoms of it.
