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

## Re-recording the Autobahn baseline

The gate's evaluation half needs nothing but a report. `node tests/autobahn/run.ts
--from-report PATH` reads an existing `servers/index.json` and produces the same summary
and the same exit code a full run does, with no container, no target, and no network.

Generating that report is the part that needs the digest-pinned fuzzing client, which is
a frozen Python 2.7 image and so a Docker-capable host. The two halves were conflated,
which made "I have no Docker here" read as "I cannot check the gate at all" -- and that
is the reason a protocol fix could not ship alongside a regenerated baseline, since the
gate deliberately _fails_ a run whose `baseline.json` lists a case that now passes.

So the loop is: record on a Docker-capable host, copy the report out, gate it anywhere.

## Updating these tables

Update the affected row in the same change that moves the status.

## Where the surface stands

The two socket routes are named throughout these tables:

- **codec route**: `WebSocketServer` builds a Node `http.Server`, answers the `upgrade`
  request in `src/compat/server/upgrade.ts`, adopts the resulting `Duplex` in
  `src/compat/socket/attach.ts`, and hands its bytes to the Zig frame codec in
  `src/compat/socket/codec-inbound.ts`. This is the route every public surface reaches.
- **engine route**: a socket created by `attachNativeSocket`, which the facade's
  constructors never call. It is exercised by `tests/binding/`, `tests/autobahn/`, and
  `bench/`, and it is where the engine's own RFC 6455 implementation is measured.

Both architectures `COMPATIBILITY.md` used to name for the codec route are now settled,
and the decision is recorded as
[ADR 0001](adr/0001-transport-and-framing-ownership.md). A TypeScript receiver over the
adopted `Duplex` was rejected because it duplicates framing the architecture says Zig
will own and hands UTF-8 validation, masking, and length checks to the runtime. Reducing
`WebSocketServer` to a `noServer`-shaped shim was rejected because it changes the
transport model of every public server surface and drops the client. What replaced both
is a third shape: Node keeps the transport, which is what the drop-in contract requires
anyway, and a pure Zig frame codec behind a Node-API handle takes over parsing, masking,
UTF-8, fragmentation, control frames, and backpressure.

The client is the other half of the same decision and is implemented: Node's `net` and
`tls` own the connection and the codec owns the framing, in the client role, because a
client masks and a server must not. `src/compat/client/` splits the handshake into the
decisions it is made of, and `tests/compat/client/` runs a real `ws` server as the peer
in both directions, the mirror of the codec route's suites.

## Re-recording the Autobahn baseline

The gate's evaluation half needs nothing but a report. `node tests/autobahn/run.ts
--from-report PATH` reads an existing `servers/index.json` and produces the same summary
and the same exit code a full run does, with no container, no target, and no network.

Generating that report is the part that needs the digest-pinned fuzzing client, which is
a frozen Python 2.7 image and so a Docker-capable host. The two halves were conflated,
which made "I have no Docker here" read as "I cannot check the gate at all" -- and that
is the reason a protocol fix could not ship alongside a regenerated baseline, since the
gate deliberately _fails_ a run whose `baseline.json` lists a case that now passes.

So the loop is: record on a Docker-capable host, copy the report out, gate it anywhere.

## Updating these tables

Update the affected row in the same change that moves the status.

`COMPATIBILITY.md` carries a "What is still outstanding" section naming the four rows
that are not `done`, what each one is missing, and what the change costs. That section
is the honest summary: a matrix whose rows are all `done` and whose prose describes
limitations is worse than one that says which four and why.
