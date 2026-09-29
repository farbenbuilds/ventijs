# ws surface compliance map

The upstream `ws` API reference is vendored at [ventiws.md](ventiws.md). This
directory maps each item in that reference to the ventiws module that implements it
and to its status.

The pinned contract is `ws` 8.21.3 with `@types/ws` 8.18.1. Both are
devDependencies, so the conformance suite can run the two implementations side
by side. The public type surface is the vendored declaration file
`src/types/ws.d.ts`.

| Document                                                                                   | Question it answers                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [COMPATIBILITY.md](../COMPATIBILITY.md)                                                    | Which behaviour is verified, and by which test?                               |
| [adr/0001-transport-and-framing-ownership.md](adr/0001-transport-and-framing-ownership.md) | Why Node owns the socket and Zig owns the frame codec, and what was rejected  |
| [docs/compliance-api.md](compliance-api.md)                                                | Which module implements each `ws` API item?                                   |
| [docs/compliance-error-codes.md](compliance-error-codes.md)                                | Which `WS_ERR_*` codes and environment variables can occur, and which cannot? |
| [docs/ventiws.md](ventiws.md)                                                              | What does `ws` do? The contract, not a feature list.                          |

## Status vocabulary

| Status        | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `done`        | Implemented and covered by a passing evidence test                              |
| `partial`     | Exists in a limited form; the row names what is missing                         |
| `todo`        | Planned, not implemented                                                        |
| `deferred`    | Out of scope until the named prerequisite lands                                 |
| `unreachable` | No counterpart by construction; the row states the architecture that removes it |

`unreachable` is not a polite word for `todo`. It means no implementation is owed,
so a row marked it must name the decision that removes the item rather than the work
that would add it.

## Rules for these tables

- A row is only `done` when its evidence test exists and passes. A test that is
  written but failing is not evidence.
- Every status is traceable to a module under `src/` and, where one exists, to a
  test under `tests/`. A row with neither is a claim, not a status.
- A row whose behaviour diverges from `ws` says so in the note and names the
  file that records the divergence.
- `partial` is not a polite word for `todo`. It means the surface exists, a
  caller can reach it, and something observable is missing. The note says what.
- A comparison is evidence only if its reference leg can fail. A conformance
  scenario that runs both implementations against a stub, or against a harness
  that answers `send` and `close` from memory, asserts nothing about the
  ordering the row is about; the fix is a real peer on each leg, and the row
  says so when the evidence changes.
- Update the affected row in the same change that moves the status.

## Where the surface stands

Two socket routes, and the tables name one or the other throughout:

- **codec route**: `WebSocketServer` builds a Node `http.Server`, answers the `upgrade`
  request in `src/compat/server/upgrade.ts`, adopts the resulting `Duplex` in
  `src/compat/socket/attach.ts`, and hands its bytes to the Zig frame codec in
  `src/compat/socket/codec-inbound.ts`. This is the route every public surface reaches.
- **engine route**: a socket created by `attachNativeSocket`, which the facade's
  constructors never call. It is exercised by `tests/binding/`, `tests/autobahn/`, and
  `bench/`, and it is where the engine's own RFC 6455 implementation is measured.

Node keeps the transport and the Zig codec keeps the framing, on both routes and in
the client role, because a client masks and a server must not. The rejected
alternatives are in
[ADR 0001](adr/0001-transport-and-framing-ownership.md).

`COMPATIBILITY.md` carries a "What is still outstanding" section. A row is listed there
when it is short of `ws` behaviour rather than short of evidence, and the section says
which of the two it is.

## Re-recording the Autobahn baseline

`node tests/autobahn/run.ts --from-report PATH` reads an existing
`servers/index.json` and produces the same summary and the same exit code a full run
does, with no container, no target, and no network. Recording that report is the
part that needs the digest-pinned fuzzing client, a frozen Python 2.7 image and so
a Docker-capable host. Record on a Docker-capable host, copy the report out, gate it
anywhere.
